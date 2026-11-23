const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { isStudent } = require('../middleware/auth');

// Apply student guard middleware to all routes in this router
router.use(isStudent);

// ==============================================================================
// 1. STUDENT DASHBOARD
// ==============================================================================
router.get('/dashboard', async (req, res) => {
    try {
        const studentId = req.session.user.id;

        // Fetch student's personal metrics
        const [[metrics]] = await db.execute(`
            SELECT 
                COUNT(CASE WHEN status IN ('Issued', 'Overdue') THEN 1 END) AS currently_issued,
                COUNT(CASE WHEN status = 'Issued' AND due_date < CURRENT_DATE THEN 1 END) AS overdue_count,
                COUNT(CASE WHEN status = 'Returned' THEN 1 END) AS total_returned,
                COALESCE(SUM(fine_amount), 0.00) AS total_fines
            FROM book_issues 
            WHERE student_id = ?
        `, [studentId]);

        // Active issued books for this student
        const [activeIssues] = await db.execute(`
            SELECT 
                bi.issue_id,
                b.title AS book_title,
                b.author,
                b.isbn,
                b.shelf_location,
                bi.issue_date,
                bi.due_date,
                DATEDIFF(CURRENT_DATE, bi.due_date) AS days_difference,
                bi.status
            FROM book_issues bi
            JOIN books b ON bi.book_id = b.book_id
            WHERE bi.student_id = ? AND bi.status IN ('Issued', 'Overdue')
            ORDER BY bi.due_date ASC
        `, [studentId]);

        // Update overdue calculations
        activeIssues.forEach(item => {
            if (item.days_difference > 0) {
                item.is_overdue = true;
                item.estimated_fine = (item.days_difference * 5.00).toFixed(2);
            } else {
                item.is_overdue = false;
                item.estimated_fine = '0.00';
            }
        });

        // Recommended / Popular books in CSE
        const [popularBooks] = await db.query(`
            SELECT b.book_id, b.title, b.author, c.category_name, b.available_copies
            FROM books b
            JOIN categories c ON b.category_id = c.category_id
            WHERE b.available_copies > 0
            ORDER BY b.book_id ASC
            LIMIT 4
        `);

        res.render('student/dashboard', {
            title: 'Student Dashboard - Library Management System',
            metrics,
            activeIssues,
            popularBooks,
            user: req.session.user
        });

    } catch (error) {
        console.error('Student Dashboard Error:', error);
        req.session.errorMessage = 'Failed to load student dashboard.';
        res.redirect('/auth/login');
    }
});

// ==============================================================================
// 2. BROWSE & SEARCH BOOKS CATALOG
// ==============================================================================
router.get('/books', async (req, res) => {
    try {
        const { search, category, availability } = req.query;

        let query = `
            SELECT 
                b.book_id,
                b.isbn,
                b.title,
                b.author,
                b.publisher,
                b.publish_year,
                b.total_copies,
                b.available_copies,
                b.shelf_location,
                c.category_id,
                c.category_name
            FROM books b
            JOIN categories c ON b.category_id = c.category_id
            WHERE 1=1
        `;
        const params = [];

        if (search && search.trim() !== '') {
            query += ` AND (b.title LIKE ? OR b.author LIKE ? OR b.isbn LIKE ?)`;
            const term = `%${search.trim()}%`;
            params.push(term, term, term);
        }

        if (category && category !== 'all') {
            query += ` AND b.category_id = ?`;
            params.push(parseInt(category, 10));
        }

        if (availability === 'available') {
            query += ` AND b.available_copies > 0`;
        }

        query += ` ORDER BY b.title ASC`;

        const [books] = await db.query(query, params);
        const [categories] = await db.query('SELECT category_id, category_name FROM categories ORDER BY category_name ASC');

        res.render('student/books', {
            title: 'Browse Library Books - Student Portal',
            books,
            categories,
            searchQuery: search || '',
            selectedCategory: category || 'all',
            selectedAvailability: availability || 'all',
            user: req.session.user
        });

    } catch (error) {
        console.error('Student Books Search Error:', error);
        req.session.errorMessage = 'Could not load book catalog.';
        res.redirect('/student/dashboard');
    }
});

// POST /student/borrow/:id - Student Self-Service Book Borrow
router.post('/borrow/:id', async (req, res) => {
    let connection;
    try {
        const bookId = parseInt(req.params.id, 10);
        const studentId = req.session.user.id;
        const defaultDays = 14;

        connection = await db.pool.getConnection();
        await connection.beginTransaction();

        // 1. Check if student is active
        const [students] = await connection.execute(
            'SELECT status, full_name FROM students WHERE student_id = ?',
            [studentId]
        );

        if (students.length === 0 || students[0].status !== 'Active') {
            await connection.rollback();
            req.session.errorMessage = 'Cannot borrow book: Your student account is blocked or inactive.';
            return res.redirect('/student/books');
        }

        // 2. Check if student already has an active copy of this book
        const [alreadyIssued] = await connection.execute(
            "SELECT issue_id FROM book_issues WHERE student_id = ? AND book_id = ? AND status IN ('Issued', 'Overdue')",
            [studentId, bookId]
        );
        if (alreadyIssued.length > 0) {
            await connection.rollback();
            req.session.errorMessage = 'You already have an active copy of this book borrowed!';
            return res.redirect('/student/my-issues');
        }

        // 3. Check active limit (maximum 4 books)
        const [activeCount] = await connection.execute(
            "SELECT COUNT(*) AS total FROM book_issues WHERE student_id = ? AND status IN ('Issued', 'Overdue')",
            [studentId]
        );
        if (activeCount[0].total >= 4) {
            await connection.rollback();
            req.session.errorMessage = 'Borrow limit reached: You can hold at most 4 books at a time. Return an existing book first.';
            return res.redirect('/student/my-issues');
        }

        // 4. Lock book row and check availability
        const [books] = await connection.execute(
            'SELECT title, available_copies FROM books WHERE book_id = ?',
            [bookId]
        );
        if (books.length === 0 || books[0].available_copies <= 0) {
            await connection.rollback();
            req.session.errorMessage = 'Sorry, this book is currently out of stock!';
            return res.redirect('/student/books');
        }

        // 5. Calculate issue and due dates
        const issueDate = new Date();
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + defaultDays);

        const issueDateStr = issueDate.toISOString().split('T')[0];
        const dueDateStr = dueDate.toISOString().split('T')[0];

        // 6. Insert into book_issues (admin_id 1 represents Central Library Desk)
        await connection.execute(`
            INSERT INTO book_issues (book_id, student_id, admin_id, issue_date, due_date, status, remarks)
            VALUES (?, ?, 1, ?, ?, 'Issued', 'Self-service online borrow')
        `, [bookId, studentId, issueDateStr, dueDateStr]);

        // 7. Decrement available copies in books catalog
        await connection.execute(
            'UPDATE books SET available_copies = available_copies - 1 WHERE book_id = ?',
            [bookId]
        );

        await connection.commit();

        req.session.successMessage = `🎉 Successfully borrowed "${books[0].title}"! Due date: ${dueDateStr}.`;
        res.redirect('/student/my-issues');

    } catch (err) {
        if (connection) await connection.rollback();
        console.error('Student Borrow Error:', err);
        req.session.errorMessage = 'Failed to borrow book. Please try again.';
        res.redirect('/student/books');
    } finally {
        if (connection) connection.release();
    }
});

// ==============================================================================
// 3. MY ISSUED BOOKS & BORROWING HISTORY
// ==============================================================================
router.get('/my-issues', async (req, res) => {
    try {
        const studentId = req.session.user.id;

        // Fetch all borrowing transactions for this student
        const [issues] = await db.execute(`
            SELECT 
                bi.issue_id,
                b.title AS book_title,
                b.author,
                b.isbn,
                b.shelf_location,
                bi.issue_date,
                bi.due_date,
                bi.return_date,
                bi.fine_amount,
                bi.status,
                bi.remarks,
                a.full_name AS issued_by_admin,
                DATEDIFF(CURRENT_DATE, bi.due_date) AS days_difference
            FROM book_issues bi
            JOIN books b ON bi.book_id = b.book_id
            JOIN admins a ON bi.admin_id = a.admin_id
            WHERE bi.student_id = ?
            ORDER BY bi.issue_id DESC
        `, [studentId]);

        // Split into active loans and past history
        const activeLoans = [];
        const borrowingHistory = [];

        issues.forEach(item => {
            if (item.status === 'Issued' || item.status === 'Overdue') {
                if (item.days_difference > 0) {
                    item.is_overdue = true;
                    item.status = 'Overdue';
                    item.estimated_fine = (item.days_difference * 5.00).toFixed(2);
                } else {
                    item.is_overdue = false;
                    item.estimated_fine = '0.00';
                }
                activeLoans.push(item);
            } else {
                borrowingHistory.push(item);
            }
        });

        res.render('student/my_issues', {
            title: 'My Borrowed Books & History - Student Portal',
            activeLoans,
            borrowingHistory,
            user: req.session.user
        });

    } catch (error) {
        console.error('My Issues Error:', error);
        req.session.errorMessage = 'Unable to fetch borrowing records.';
        res.redirect('/student/dashboard');
    }
});

// POST /student/return/:id - Student Return Book with Fine Assessment
router.post('/return/:id', async (req, res) => {
    let connection;
    try {
        const issueId = parseInt(req.params.id, 10);
        const studentId = req.session.user.id;

        connection = await db.pool.getConnection();
        await connection.beginTransaction();

        // 1. Lock and retrieve issue record
        const [rows] = await connection.execute(
            'SELECT issue_id, book_id, due_date, status FROM book_issues WHERE issue_id = ? AND student_id = ?',
            [issueId, studentId]
        );

        if (rows.length === 0) {
            await connection.rollback();
            req.session.errorMessage = 'Issue record not found or does not belong to you.';
            return res.redirect('/student/my-issues');
        }

        const issue = rows[0];

        if (issue.status === 'Returned') {
            await connection.rollback();
            req.session.errorMessage = 'This book has already been returned.';
            return res.redirect('/student/my-issues');
        }

        // 2. Calculate fine: ₹5 per day after 14 days (due_date)
        const returnDate = new Date();
        const dueDate = new Date(issue.due_date);
        const diffTime = returnDate.getTime() - dueDate.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        let fine = 0.00;
        if (diffDays > 0) {
            fine = diffDays * 5.00;
        }

        const returnDateStr = returnDate.toISOString().split('T')[0];

        // 3. Update issue record
        await connection.execute(`
            UPDATE book_issues 
            SET return_date = ?, fine_amount = ?, status = 'Returned'
            WHERE issue_id = ?
        `, [returnDateStr, fine, issueId]);

        // 4. Increment available copies in books catalog
        await connection.execute(
            'UPDATE books SET available_copies = available_copies + 1 WHERE book_id = ?',
            [issue.book_id]
        );

        await connection.commit();

        if (fine > 0) {
            req.session.successMessage = `Book returned successfully! ⚠️ Returned ${diffDays} day(s) after the 14-day limit. Late fine applied: ₹${fine.toFixed(2)} (₹5/day). Please pay at the library desk.`;
        } else {
            req.session.successMessage = `✅ Book returned successfully on time (within 14 days)! No fine charged (₹0.00).`;
        }
        res.redirect('/student/my-issues');

    } catch (err) {
        if (connection) await connection.rollback();
        console.error('Student Return Error:', err);
        req.session.errorMessage = 'Failed to return book. Please try again.';
        res.redirect('/student/my-issues');
    } finally {
        if (connection) connection.release();
    }
});

// ==============================================================================
// 4. STUDENT PROFILE & PASSWORD MANAGEMENT
// ==============================================================================
router.get('/profile', async (req, res) => {
    try {
        const studentId = req.session.user.id;
        const [rows] = await db.execute(`
            SELECT student_id, roll_number, full_name, email, phone, department, semester, status, created_at
            FROM students
            WHERE student_id = ?
        `, [studentId]);

        if (rows.length === 0) {
            req.session.errorMessage = 'Student profile not found.';
            return res.redirect('/student/dashboard');
        }

        res.render('student/profile', {
            title: 'My Profile - Student Portal',
            student: rows[0],
            user: req.session.user
        });

    } catch (error) {
        console.error('Profile Error:', error);
        res.redirect('/student/dashboard');
    }
});

// POST /student/change-password - Update password
router.post('/change-password', async (req, res) => {
    try {
        const studentId = req.session.user.id;
        const { current_password, new_password, confirm_password } = req.body;

        if (!current_password || !new_password || !confirm_password) {
            req.session.errorMessage = 'All password fields are required.';
            return res.redirect('/student/profile');
        }

        if (new_password.length < 6) {
            req.session.errorMessage = 'New password must be at least 6 characters.';
            return res.redirect('/student/profile');
        }

        if (new_password !== confirm_password) {
            req.session.errorMessage = 'New password and confirmation do not match.';
            return res.redirect('/student/profile');
        }

        const [rows] = await db.execute('SELECT password_hash FROM students WHERE student_id = ?', [studentId]);
        if (rows.length === 0) {
            return res.redirect('/student/profile');
        }

        const isMatch = await bcrypt.compare(current_password, rows[0].password_hash);
        if (!isMatch) {
            req.session.errorMessage = 'Current password entered is incorrect.';
            return res.redirect('/student/profile');
        }

        const newHash = await bcrypt.hash(new_password, 10);
        await db.execute('UPDATE students SET password_hash = ? WHERE student_id = ?', [newHash, studentId]);

        req.session.successMessage = 'Password updated successfully!';
        res.redirect('/student/profile');

    } catch (error) {
        console.error('Change Password Error:', error);
        req.session.errorMessage = 'Failed to change password.';
        res.redirect('/student/profile');
    }
});

module.exports = router;
