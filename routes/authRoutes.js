const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { redirectIfLoggedIn } = require('../middleware/auth');

// GET /auth/login - Display login page
router.get('/login', redirectIfLoggedIn, (req, res) => {
    const activeTab = req.query.tab === 'admin' ? 'admin' : 'student';
    res.render('auth/login', { 
        title: 'Login - Library Management System',
        activeTab 
    });
});

// POST /auth/login/admin - Process Admin Login
router.post('/login/admin', redirectIfLoggedIn, async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            req.session.errorMessage = 'Please provide both username and password.';
            return res.redirect('/auth/login?tab=admin');
        }

        // Parameterized prepared query to prevent SQL Injection
        const [rows] = await db.execute(
            'SELECT admin_id, username, password_hash, full_name, email, role FROM admins WHERE username = ?',
            [username.trim()]
        );

        if (rows.length === 0) {
            req.session.errorMessage = 'Invalid admin credentials.';
            return res.redirect('/auth/login?tab=admin');
        }

        const admin = rows[0];
        const isMatch = await bcrypt.compare(password, admin.password_hash);

        if (!isMatch) {
            req.session.errorMessage = 'Invalid admin credentials.';
            return res.redirect('/auth/login?tab=admin');
        }

        // Set session
        req.session.user = {
            id: admin.admin_id,
            username: admin.username,
            name: admin.full_name,
            email: admin.email,
            role: 'admin',
            title: admin.role || 'Librarian'
        };

        req.session.successMessage = `Welcome back, ${admin.full_name}!`;
        res.redirect('/admin/dashboard');

    } catch (error) {
        console.error('Admin Login Error:', error);
        req.session.errorMessage = 'Database error occurred during login. Please try again.';
        res.redirect('/auth/login?tab=admin');
    }
});

// POST /auth/login/student - Process Student Login
router.post('/login/student', redirectIfLoggedIn, async (req, res) => {
    try {
        const { identifier, password } = req.body; // Can be roll_number or email

        if (!identifier || !password) {
            req.session.errorMessage = 'Please provide your Roll Number / Email and password.';
            return res.redirect('/auth/login?tab=student');
        }

        // Parameterized prepared statement
        const [rows] = await db.execute(
            'SELECT student_id, roll_number, full_name, email, department, semester, password_hash, status FROM students WHERE roll_number = ? OR email = ?',
            [identifier.trim(), identifier.trim()]
        );

        if (rows.length === 0) {
            req.session.errorMessage = 'Student record not found. Please check your credentials or register.';
            return res.redirect('/auth/login?tab=student');
        }

        const student = rows[0];

        if (student.status === 'Blocked') {
            req.session.errorMessage = 'Your account has been blocked by the librarian. Please contact the library desk.';
            return res.redirect('/auth/login?tab=student');
        }

        const isMatch = await bcrypt.compare(password, student.password_hash);
        if (!isMatch) {
            req.session.errorMessage = 'Invalid password.';
            return res.redirect('/auth/login?tab=student');
        }

        // Set student session
        req.session.user = {
            id: student.student_id,
            roll_number: student.roll_number,
            name: student.full_name,
            email: student.email,
            department: student.department,
            semester: student.semester,
            role: 'student'
        };

        req.session.successMessage = `Welcome, ${student.full_name}!`;
        res.redirect('/student/dashboard');

    } catch (error) {
        console.error('Student Login Error:', error);
        req.session.errorMessage = 'Database error occurred during login.';
        res.redirect('/auth/login?tab=student');
    }
});

// GET /auth/register - Display student registration page
router.get('/register', redirectIfLoggedIn, (req, res) => {
    res.render('auth/register', { 
        title: 'Student Registration - Library Management System' 
    });
});

// POST /auth/register - Process Student Registration
router.post('/register', redirectIfLoggedIn, async (req, res) => {
    try {
        const { roll_number, full_name, email, phone, department, semester, password, confirm_password } = req.body;

        // Validation
        if (!roll_number || !full_name || !email || !password) {
            req.session.errorMessage = 'Please fill in all required fields.';
            return res.redirect('/auth/register');
        }

        if (password.length < 6) {
            req.session.errorMessage = 'Password must be at least 6 characters long.';
            return res.redirect('/auth/register');
        }

        if (password !== confirm_password) {
            req.session.errorMessage = 'Passwords do not match.';
            return res.redirect('/auth/register');
        }

        // Check if roll number or email already exists (Integrity constraint check)
        const [existing] = await db.execute(
            'SELECT student_id, roll_number, email FROM students WHERE roll_number = ? OR email = ?',
            [roll_number.trim(), email.trim()]
        );

        if (existing.length > 0) {
            if (existing[0].roll_number.toLowerCase() === roll_number.trim().toLowerCase()) {
                req.session.errorMessage = 'A student with this Roll Number is already registered.';
            } else {
                req.session.errorMessage = 'A student with this Email is already registered.';
            }
            return res.redirect('/auth/register');
        }

        // Hash password
        const password_hash = await bcrypt.hash(password, 10);

        // Insert new student using prepared statement
        await db.execute(
            `INSERT INTO students (roll_number, full_name, email, phone, department, semester, password_hash, status) 
             VALUES (?, ?, ?, ?, ?, ?, ?, 'Active')`,
            [
                roll_number.trim().toUpperCase(),
                full_name.trim(),
                email.trim().toLowerCase(),
                phone ? phone.trim() : null,
                department || 'CSE',
                parseInt(semester, 10) || 4,
                password_hash
            ]
        );

        req.session.successMessage = 'Registration successful! You can now log in with your credentials.';
        res.redirect('/auth/login?tab=student');

    } catch (error) {
        console.error('Registration Error:', error);
        req.session.errorMessage = 'An error occurred during registration. Please try again.';
        res.redirect('/auth/register');
    }
});

// GET /auth/logout - Log out current session
router.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) console.error('Logout error:', err);
        res.redirect('/auth/login?logout=success');
    });
});

module.exports = router;
