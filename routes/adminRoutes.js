const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { isAdmin } = require('../middleware/auth');

// Apply admin guard middleware to all routes in this router
router.use(isAdmin);

// ==============================================================================
// 1. ADMIN DASHBOARD
// ==============================================================================
router.get('/dashboard', async (req, res) => {
    try {
        // Aggregate statistics using single & multi-table aggregation queries
        const [[stats]] = await db.query(`
            SELECT 
                (SELECT COUNT(*) FROM books) AS total_titles,
                (SELECT COALESCE(SUM(total_copies), 0) FROM books) AS total_book_copies,
                (SELECT COALESCE(SUM(available_copies), 0) FROM books) AS available_copies,
                (SELECT COUNT(*) FROM book_issues WHERE status = 'Issued' OR status = 'Overdue') AS currently_issued,
                (SELECT COUNT(*) FROM book_issues WHERE status = 'Issued' AND due_date < CURRENT_DATE) AS overdue_count,
                (SELECT COUNT(*) FROM students) AS total_students,
                (SELECT COUNT(*) FROM categories) AS total_categories,
                (SELECT COALESCE(SUM(fine_amount), 0.00) FROM book_issues WHERE status = 'Returned') AS fines_collected
        `);

        // Recent Issues (last 5 records)
        const [recentIssues] = await db.query(`
            SELECT 
                bi.issue_id,
                b.title AS book_title,
                s.roll_number,
                s.full_name AS student_name,
                bi.issue_date,
                bi.due_date,
                bi.status
            FROM book_issues bi
            JOIN books b ON bi.book_id = b.book_id
            JOIN students s ON bi.student_id = s.student_id
            ORDER BY bi.issue_id DESC 
            LIMIT 5
        `);

        // Low stock books (available_copies <= 1)
        const [lowStockBooks] = await db.query(`
            SELECT book_id, title, author, total_copies, available_copies
            FROM books
            WHERE available_copies <= 1
            ORDER BY available_copies ASC
            LIMIT 5
        `);

        res.render('admin/dashboard', {
            title: 'Admin Dashboard - Library Management System',
            stats,
            recentIssues,
            lowStockBooks,
            user: req.session.user
        });

    } catch (error) {
        console.error('Admin Dashboard Error:', error);
        req.session.errorMessage = 'Failed to load dashboard metrics.';
        res.render('admin/dashboard', {
            title: 'Admin Dashboard - Error',
            stats: {},
            recentIssues: [],
            lowStockBooks: [],
            user: req.session.user
        });
    }
});

// ==============================================================================
// 2. BOOK MANAGEMENT (CRUD)
// ==============================================================================

// GET /admin/books - List books with search and category filters
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
                (b.total_copies - b.available_copies) AS issued_copies,
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
        } else if (availability === 'out') {
            query += ` AND b.available_copies = 0`;
        }

        query += ` ORDER BY b.book_id DESC`;

        const [books] = await db.query(query, params);
        const [categories] = await db.query('SELECT category_id, category_name FROM categories ORDER BY category_name ASC');

        res.render('admin/books', {
            title: 'Manage Books - Library Admin',
            books,
            categories,
            searchQuery: search || '',
            selectedCategory: category || 'all',
            selectedAvailability: availability || 'all',
            user: req.session.user
        });

    } catch (error) {
        console.error('Books List Error:', error);
        req.session.errorMessage = 'Unable to fetch books.';
        res.redirect('/admin/dashboard');
    }
});

// GET /admin/books/add - Render Add Book Form
router.get('/books/add', async (req, res) => {
    try {
        const [categories] = await db.query('SELECT category_id, category_name FROM categories ORDER BY category_name ASC');
        res.render('admin/book_form', {
            title: 'Add New Book - Library Admin',
            action: 'add',
            book: null,
            categories,
            user: req.session.user
        });
    } catch (error) {
        req.session.errorMessage = 'Could not load form.';
        res.redirect('/admin/books');
    }
});

// POST /admin/books/add - Process Add Book
router.post('/books/add', async (req, res) => {
    try {
        const { isbn, title, author, category_id, publisher, publish_year, total_copies, shelf_location } = req.body;

        if (!isbn || !title || !author || !category_id || !total_copies) {
            req.session.errorMessage = 'Please fill all required fields.';
            return res.redirect('/admin/books/add');
        }

        const copies = parseInt(total_copies, 10);
        if (copies < 1) {
            req.session.errorMessage = 'Total copies must be at least 1.';
            return res.redirect('/admin/books/add');
        }

        // Check if ISBN already exists
        const [existing] = await db.execute('SELECT book_id FROM books WHERE isbn = ?', [isbn.trim()]);
        if (existing.length > 0) {
            req.session.errorMessage = 'A book with this ISBN already exists.';
            return res.redirect('/admin/books/add');
        }

        // Insert new book with available_copies equal to total_copies
        await db.execute(`
            INSERT INTO books (isbn, title, author, category_id, publisher, publish_year, total_copies, available_copies, shelf_location)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            isbn.trim(),
            title.trim(),
            author.trim(),
            parseInt(category_id, 10),
            publisher ? publisher.trim() : null,
            publish_year ? parseInt(publish_year, 10) : null,
            copies,
            copies, // initially all copies are available
            shelf_location ? shelf_location.trim() : 'Shelf-A1'
        ]);

        req.session.successMessage = `Book "${title}" added successfully!`;
        res.redirect('/admin/books');

    } catch (error) {
        console.error('Add Book Error:', error);
        req.session.errorMessage = 'Database error while saving book.';
        res.redirect('/admin/books/add');
    }
});

// GET /admin/books/edit/:id - Render Edit Book Form
router.get('/books/edit/:id', async (req, res) => {
    try {
        const bookId = parseInt(req.params.id, 10);
        const [rows] = await db.execute('SELECT * FROM books WHERE book_id = ?', [bookId]);

        if (rows.length === 0) {
            req.session.errorMessage = 'Book not found.';
            return res.redirect('/admin/books');
        }

        const [categories] = await db.query('SELECT category_id, category_name FROM categories ORDER BY category_name ASC');

        res.render('admin/book_form', {
            title: 'Edit Book - Library Admin',
            action: 'edit',
            book: rows[0],
            categories,
            user: req.session.user
        });

    } catch (error) {
        console.error('Edit Book Form Error:', error);
        res.redirect('/admin/books');
    }
});

// POST /admin/books/edit/:id - Process Edit Book
router.post('/books/edit/:id', async (req, res) => {
    try {
        const bookId = parseInt(req.params.id, 10);
        const { isbn, title, author, category_id, publisher, publish_year, total_copies, shelf_location } = req.body;

        const [existing] = await db.execute('SELECT * FROM books WHERE book_id = ?', [bookId]);
        if (existing.length === 0) {
            req.session.errorMessage = 'Book not found.';
            return res.redirect('/admin/books');
        }

        const currentBook = existing[0];
        const newTotalCopies = parseInt(total_copies, 10);
        const issuedCopies = currentBook.total_copies - currentBook.available_copies;

        // Validation: new total copies cannot be less than currently issued copies
        if (newTotalCopies < issuedCopies) {
            req.session.errorMessage = `Cannot reduce total copies below currently issued copies (${issuedCopies}).`;
            return res.redirect(`/admin/books/edit/${bookId}`);
        }

        const newAvailableCopies = newTotalCopies - issuedCopies;

        // Check if ISBN is used by another book
        const [duplicateIsbn] = await db.execute(
            'SELECT book_id FROM books WHERE isbn = ? AND book_id != ?',
            [isbn.trim(), bookId]
        );
        if (duplicateIsbn.length > 0) {
            req.session.errorMessage = 'Another book already exists with this ISBN.';
            return res.redirect(`/admin/books/edit/${bookId}`);
        }

        await db.execute(`
            UPDATE books 
            SET isbn = ?, title = ?, author = ?, category_id = ?, publisher = ?, publish_year = ?, 
                total_copies = ?, available_copies = ?, shelf_location = ?
            WHERE book_id = ?
        `, [
            isbn.trim(),
            title.trim(),
            author.trim(),
            parseInt(category_id, 10),
            publisher ? publisher.trim() : null,
            publish_year ? parseInt(publish_year, 10) : null,
            newTotalCopies,
            newAvailableCopies,
            shelf_location ? shelf_location.trim() : 'Shelf-A1',
            bookId
        ]);

        req.session.successMessage = `Book "${title}" updated successfully!`;
        res.redirect('/admin/books');

    } catch (error) {
        console.error('Update Book Error:', error);
        req.session.errorMessage = 'Failed to update book.';
        res.redirect(`/admin/books/edit/${req.params.id}`);
    }
});

// POST /admin/books/delete/:id - Delete Book (Ensures referential integrity)
router.post('/books/delete/:id', async (req, res) => {
    try {
        const bookId = parseInt(req.params.id, 10);

        // Check if book has active issues
        const [activeIssues] = await db.execute(
            "SELECT issue_id FROM book_issues WHERE book_id = ? AND status IN ('Issued', 'Overdue')",
            [bookId]
        );

        if (activeIssues.length > 0) {
            req.session.errorMessage = 'Cannot delete book: Copies are currently issued to students. Return all copies first.';
            return res.redirect('/admin/books');
        }

        // Delete past returned issue records or prevent deletion
        // To maintain history, check if any issues exist
        const [allIssues] = await db.execute('SELECT issue_id FROM book_issues WHERE book_id = ?', [bookId]);
        if (allIssues.length > 0) {
            // Delete historical issues or cascade
            await db.execute('DELETE FROM book_issues WHERE book_id = ?', [bookId]);
        }

        await db.execute('DELETE FROM books WHERE book_id = ?', [bookId]);

        req.session.successMessage = 'Book deleted from catalog successfully.';
        res.redirect('/admin/books');

    } catch (error) {
        console.error('Delete Book Error:', error);
        req.session.errorMessage = 'Database constraint error: Unable to delete book.';
        res.redirect('/admin/books');
    }
});

// ==============================================================================
// 3. CATEGORY MANAGEMENT
// ==============================================================================

// GET /admin/categories - List categories with book count
router.get('/categories', async (req, res) => {
    try {
        const [categories] = await db.query(`
            SELECT 
                c.category_id,
                c.category_name,
                c.description,
                c.created_at,
                COUNT(b.book_id) AS book_count
            FROM categories c
            LEFT JOIN books b ON c.category_id = b.category_id
            GROUP BY c.category_id, c.category_name, c.description, c.created_at
            ORDER BY c.category_name ASC
        `);

        res.render('admin/categories', {
            title: 'Manage Categories - Library Admin',
            categories,
            user: req.session.user
        });

    } catch (error) {
        console.error('Categories Error:', error);
        req.session.errorMessage = 'Failed to load categories.';
        res.redirect('/admin/dashboard');
    }
});

// POST /admin/categories/add - Add Category
router.post('/categories/add', async (req, res) => {
    try {
        const { category_name, description } = req.body;

        if (!category_name || category_name.trim() === '') {
            req.session.errorMessage = 'Category name is required.';
            return res.redirect('/admin/categories');
        }

        const [existing] = await db.execute(
            'SELECT category_id FROM categories WHERE category_name = ?',
            [category_name.trim()]
        );

        if (existing.length > 0) {
            req.session.errorMessage = 'A category with this name already exists.';
            return res.redirect('/admin/categories');
        }

        await db.execute(
            'INSERT INTO categories (category_name, description) VALUES (?, ?)',
            [category_name.trim(), description ? description.trim() : null]
        );

        req.session.successMessage = `Category "${category_name}" added successfully!`;
        res.redirect('/admin/categories');

    } catch (error) {
        console.error('Add Category Error:', error);
        req.session.errorMessage = 'Error saving category.';
        res.redirect('/admin/categories');
    }
});

// POST /admin/categories/edit/:id - Edit Category
router.post('/categories/edit/:id', async (req, res) => {
    try {
        const categoryId = parseInt(req.params.id, 10);
        const { category_name, description } = req.body;

        if (!category_name || category_name.trim() === '') {
            req.session.errorMessage = 'Category name cannot be empty.';
            return res.redirect('/admin/categories');
        }

        await db.execute(
            'UPDATE categories SET category_name = ?, description = ? WHERE category_id = ?',
            [category_name.trim(), description ? description.trim() : null, categoryId]
        );

        req.session.successMessage = 'Category updated successfully!';
        res.redirect('/admin/categories');

    } catch (error) {
        console.error('Edit Category Error:', error);
        req.session.errorMessage = 'Failed to update category.';
        res.redirect('/admin/categories');
    }
});

// POST /admin/categories/delete/:id - Delete Category (Referential Integrity Check)
router.post('/categories/delete/:id', async (req, res) => {
    try {
        const categoryId = parseInt(req.params.id, 10);

        // Check if books are assigned to this category
        const [books] = await db.execute('SELECT book_id FROM books WHERE category_id = ?', [categoryId]);
        if (books.length > 0) {
            req.session.errorMessage = `Cannot delete category: ${books.length} book(s) belong to this category. Reassign or delete those books first.`;
            return res.redirect('/admin/categories');
        }

        await db.execute('DELETE FROM categories WHERE category_id = ?', [categoryId]);
        req.session.successMessage = 'Category deleted successfully.';
        res.redirect('/admin/categories');

    } catch (error) {
        console.error('Delete Category Error:', error);
        req.session.errorMessage = 'Referential Integrity constraint prevented deletion.';
        res.redirect('/admin/categories');
    }
});

// ==============================================================================
// 4. STUDENT MANAGEMENT
// ==============================================================================

// GET /admin/students - List registered students with active borrow counts
router.get('/students', async (req, res) => {
    try {
        const search = req.query.search || '';

        let query = `
            SELECT 
                s.student_id,
                s.roll_number,
                s.full_name,
                s.email,
                s.phone,
                s.department,
                s.semester,
                s.status,
                s.created_at,
                COUNT(CASE WHEN bi.status IN ('Issued', 'Overdue') THEN 1 END) AS active_borrowed_count
            FROM students s
            LEFT JOIN book_issues bi ON s.student_id = bi.student_id
            WHERE 1=1
        `;
        const params = [];

        if (search.trim() !== '') {
            query += ` AND (s.roll_number LIKE ? OR s.full_name LIKE ? OR s.email LIKE ?)`;
            const term = `%${search.trim()}%`;
            params.push(term, term, term);
        }

        query += ` GROUP BY s.student_id ORDER BY s.roll_number ASC`;

        const [students] = await db.query(query, params);

        res.render('admin/students', {
            title: 'Manage Students - Library Admin',
            students,
            searchQuery: search,
            user: req.session.user
        });

    } catch (error) {
        console.error('Students List Error:', error);
        req.session.errorMessage = 'Unable to load students.';
        res.redirect('/admin/dashboard');
    }
});

// POST /admin/students/toggle-status/:id - Toggle student active/blocked status
router.post('/students/toggle-status/:id', async (req, res) => {
    try {
        const studentId = parseInt(req.params.id, 10);
        const [rows] = await db.execute('SELECT status, full_name FROM students WHERE student_id = ?', [studentId]);

        if (rows.length === 0) {
            req.session.errorMessage = 'Student not found.';
            return res.redirect('/admin/students');
        }

        const newStatus = rows[0].status === 'Active' ? 'Blocked' : 'Active';
        await db.execute('UPDATE students SET status = ? WHERE student_id = ?', [newStatus, studentId]);

        req.session.successMessage = `Student ${rows[0].full_name} is now ${newStatus}.`;
        res.redirect('/admin/students');

    } catch (error) {
        console.error('Toggle Student Status Error:', error);
        req.session.errorMessage = 'Failed to change student status.';
        res.redirect('/admin/students');
    }
});

// ==============================================================================
// 5. BOOK ISSUE & RETURN TRANSACTIONS (ACID Compliance)
// ==============================================================================

// GET /admin/issue - Render Issue Book Form
router.get('/issue', async (req, res) => {
    try {
        // Only show books that have available copies > 0
        const [availableBooks] = await db.query(`
            SELECT book_id, isbn, title, author, available_copies 
            FROM books 
            WHERE available_copies > 0 
            ORDER BY title ASC
        `);

        // Only active students
        const [activeStudents] = await db.query(`
            SELECT student_id, roll_number, full_name, department, semester 
            FROM students 
            WHERE status = 'Active' 
            ORDER BY roll_number ASC
        `);

        const defaultDuration = parseInt(process.env.BORROW_DURATION_DAYS, 10) || 14;

        res.render('admin/issue_book', {
            title: 'Issue Book - Library Admin',
            books: availableBooks,
            students: activeStudents,
            defaultDuration,
            preSelectedBook: req.query.book_id || '',
            preSelectedStudent: req.query.student_id || '',
            user: req.session.user
        });

    } catch (error) {
        console.error('Load Issue Form Error:', error);
        req.session.errorMessage = 'Failed to load issue form.';
        res.redirect('/admin/dashboard');
    }
});

// POST /admin/issue - Execute Book Issue with Database Transaction
router.post('/issue', async (req, res) => {
    let connection;
    try {
        const { book_id, student_id, duration_days, remarks } = req.body;

        if (!book_id || !student_id) {
            req.session.errorMessage = 'Please select both a book and a student.';
            return res.redirect('/admin/issue');
        }

        const days = parseInt(duration_days, 10) || 14;
        const adminId = req.session.user.id;

        // Acquire connection from pool for transaction
        connection = await db.pool.getConnection();
        await connection.beginTransaction();

        // 1. Check student status and active borrow limit (e.g. maximum 4 books per student)
        const [students] = await connection.execute(
            'SELECT status, full_name FROM students WHERE student_id = ? FOR UPDATE',
            [parseInt(student_id, 10)]
        );

        if (students.length === 0 || students[0].status !== 'Active') {
            await connection.rollback();
            req.session.errorMessage = 'Cannot issue book: Student account is blocked or does not exist.';
            return res.redirect('/admin/issue');
        }

        const [borrowCount] = await connection.execute(
            "SELECT COUNT(*) AS active_issues FROM book_issues WHERE student_id = ? AND status IN ('Issued', 'Overdue')",
            [parseInt(student_id, 10)]
        );

        if (borrowCount[0].active_issues >= 4) {
            await connection.rollback();
            req.session.errorMessage = `Cannot issue book: Student already has ${borrowCount[0].active_issues} active books (Max allowed: 4).`;
            return res.redirect('/admin/issue');
        }

        // 2. Lock book row and check availability
        const [books] = await connection.execute(
            'SELECT title, available_copies FROM books WHERE book_id = ? FOR UPDATE',
            [parseInt(book_id, 10)]
        );

        if (books.length === 0 || books[0].available_copies <= 0) {
            await connection.rollback();
            req.session.errorMessage = 'Cannot issue book: No available copies remaining in stock.';
            return res.redirect('/admin/issue');
        }

        // 3. Compute issue and due dates
        const issueDate = new Date();
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + days);

        const issueDateStr = issueDate.toISOString().split('T')[0];
        const dueDateStr = dueDate.toISOString().split('T')[0];

        // 4. Insert into book_issues table
        await connection.execute(`
            INSERT INTO book_issues (book_id, student_id, admin_id, issue_date, due_date, status, remarks)
            VALUES (?, ?, ?, ?, ?, 'Issued', ?)
        `, [
            parseInt(book_id, 10),
            parseInt(student_id, 10),
            adminId,
            issueDateStr,
            dueDateStr,
            remarks ? remarks.trim() : null
        ]);

        // 5. Decrement available copies in books catalog
        await connection.execute(
            'UPDATE books SET available_copies = available_copies - 1 WHERE book_id = ?',
            [parseInt(book_id, 10)]
        );

        // Commit transaction
        await connection.commit();

        req.session.successMessage = `Book "${books[0].title}" successfully issued to ${students[0].full_name}! Due date: ${dueDateStr}`;
        res.redirect('/admin/issues');

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Book Issue Transaction Error:', error);
        req.session.errorMessage = 'Transaction failed. Book issue was rolled back.';
        res.redirect('/admin/issue');
    } finally {
        if (connection) connection.release();
    }
});

// GET /admin/issues - View All Issued & Returned Books with Filters
router.get('/issues', async (req, res) => {
    try {
        const { status, search } = req.query;

        let query = `
            SELECT 
                bi.issue_id,
                b.book_id,
                b.title AS book_title,
                b.isbn,
                s.student_id,
                s.roll_number,
                s.full_name AS student_name,
                s.department,
                bi.issue_date,
                bi.due_date,
                bi.return_date,
                bi.fine_amount,
                bi.status,
                bi.remarks,
                a.full_name AS issued_by,
                DATEDIFF(CURRENT_DATE, bi.due_date) AS days_difference
            FROM book_issues bi
            JOIN books b ON bi.book_id = b.book_id
            JOIN students s ON bi.student_id = s.student_id
            JOIN admins a ON bi.admin_id = a.admin_id
            WHERE 1=1
        `;
        const params = [];

        if (status && status !== 'all') {
            query += ` AND bi.status = ?`;
            params.push(status);
        }

        if (search && search.trim() !== '') {
            query += ` AND (s.roll_number LIKE ? OR s.full_name LIKE ? OR b.title LIKE ?)`;
            const term = `%${search.trim()}%`;
            params.push(term, term, term);
        }

        query += ` ORDER BY bi.issue_id DESC`;

        const [issues] = await db.query(query, params);

        // Calculate dynamic overdue stats for active records
        issues.forEach(issue => {
            if (issue.status === 'Issued' && issue.days_difference > 0) {
                issue.status = 'Overdue';
                issue.calculated_fine = (issue.days_difference * 5.00).toFixed(2);
            } else if (issue.status === 'Returned') {
                issue.calculated_fine = parseFloat(issue.fine_amount).toFixed(2);
            } else {
                issue.calculated_fine = '0.00';
            }
        });

        res.render('admin/issues_list', {
            title: 'Issued & Returned Records - Library Admin',
            issues,
            selectedStatus: status || 'all',
            searchQuery: search || '',
            user: req.session.user
        });

    } catch (error) {
        console.error('Issues List Error:', error);
        req.session.errorMessage = 'Failed to load transaction records.';
        res.redirect('/admin/dashboard');
    }
});

// POST /admin/return/:id - Accept Book Return with Automatic Fine Calculation
router.post('/return/:id', async (req, res) => {
    let connection;
    try {
        const issueId = parseInt(req.params.id, 10);

        connection = await db.pool.getConnection();
        await connection.beginTransaction();

        // 1. Lock and retrieve issue record
        const [rows] = await connection.execute(
            'SELECT issue_id, book_id, student_id, due_date, status FROM book_issues WHERE issue_id = ? FOR UPDATE',
            [issueId]
        );

        if (rows.length === 0) {
            await connection.rollback();
            req.session.errorMessage = 'Issue record not found.';
            return res.redirect('/admin/issues');
        }

        const issue = rows[0];

        if (issue.status === 'Returned') {
            await connection.rollback();
            req.session.errorMessage = 'This book has already been marked as returned.';
            return res.redirect('/admin/issues');
        }

        // 2. Calculate fine: ₹5 per day of overdue
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

        // Commit transaction
        await connection.commit();

        req.session.successMessage = `Book successfully returned! Overdue fine assessed: ₹${fine.toFixed(2)}`;
        res.redirect('/admin/issues');

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Book Return Transaction Error:', error);
        req.session.errorMessage = 'Failed to process book return.';
        res.redirect('/admin/issues');
    } finally {
        if (connection) connection.release();
    }
});

module.exports = router;
