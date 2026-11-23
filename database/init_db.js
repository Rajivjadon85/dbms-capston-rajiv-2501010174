/**
 * Database Initialization Script for Library Management System
 * Automatically sets up MySQL database, tables, views, triggers, and sample records.
 * Run with: npm run init-db
 */

const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const config = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : '',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    multipleStatements: true
};

const DB_NAME = process.env.DB_NAME || 'library_db';

async function initDatabase() {
    let connection;
    try {
        console.log(`🔌 Connecting to MySQL Server at ${config.host}:${config.port}...`);
        connection = await mysql.createConnection(config);
        console.log('✅ Connected to MySQL server.');

        console.log(`📦 Creating database "${DB_NAME}" if not exists...`);
        await connection.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
        await connection.query(`USE \`${DB_NAME}\`;`);

        console.log('🔨 Disabling foreign key checks during schema creation...');
        await connection.query(`SET FOREIGN_KEY_CHECKS = 0;`);

        // Drop existing tables for fresh setup
        console.log('🧹 Dropping existing tables if any...');
        await connection.query(`
            DROP TABLE IF EXISTS issue_audit_log;
            DROP TABLE IF EXISTS book_issues;
            DROP TABLE IF EXISTS books;
            DROP TABLE IF EXISTS students;
            DROP TABLE IF EXISTS categories;
            DROP TABLE IF EXISTS admins;
        `);

        await connection.query(`SET FOREIGN_KEY_CHECKS = 1;`);

        console.log('🏗️ Creating tables...');

        // 1. Admins Table
        await connection.query(`
            CREATE TABLE admins (
                admin_id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(50) NOT NULL UNIQUE,
                password_hash VARCHAR(255) NOT NULL,
                full_name VARCHAR(100) NOT NULL,
                email VARCHAR(100) NOT NULL UNIQUE,
                role VARCHAR(50) DEFAULT 'Librarian',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB;
        `);
        console.log('   - Table `admins` created.');

        // 2. Categories Table
        await connection.query(`
            CREATE TABLE categories (
                category_id INT AUTO_INCREMENT PRIMARY KEY,
                category_name VARCHAR(100) NOT NULL UNIQUE,
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB;
        `);
        console.log('   - Table `categories` created.');

        // 3. Students Table
        await connection.query(`
            CREATE TABLE students (
                student_id INT AUTO_INCREMENT PRIMARY KEY,
                roll_number VARCHAR(30) NOT NULL UNIQUE,
                full_name VARCHAR(100) NOT NULL,
                email VARCHAR(100) NOT NULL UNIQUE,
                phone VARCHAR(15),
                department VARCHAR(50) DEFAULT 'CSE',
                semester INT DEFAULT 4,
                password_hash VARCHAR(255) NOT NULL,
                status ENUM('Active', 'Blocked') DEFAULT 'Active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB;
        `);
        console.log('   - Table `students` created.');

        // 4. Books Table
        await connection.query(`
            CREATE TABLE books (
                book_id INT AUTO_INCREMENT PRIMARY KEY,
                isbn VARCHAR(20) NOT NULL UNIQUE,
                title VARCHAR(200) NOT NULL,
                author VARCHAR(150) NOT NULL,
                category_id INT NOT NULL,
                publisher VARCHAR(100),
                publish_year INT,
                total_copies INT NOT NULL DEFAULT 1,
                available_copies INT NOT NULL DEFAULT 1,
                shelf_location VARCHAR(50) DEFAULT 'Shelf-A1',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT fk_books_category 
                    FOREIGN KEY (category_id) REFERENCES categories(category_id) 
                    ON DELETE RESTRICT ON UPDATE CASCADE,
                CONSTRAINT chk_book_copies 
                    CHECK (available_copies <= total_copies AND available_copies >= 0)
            ) ENGINE=InnoDB;
        `);
        console.log('   - Table `books` created.');

        // Indexes on Books
        await connection.query(`
            CREATE INDEX idx_books_category ON books(category_id);
            CREATE INDEX idx_books_title ON books(title);
            CREATE INDEX idx_books_author ON books(author);
        `);

        // 5. Book Issues Table
        await connection.query(`
            CREATE TABLE book_issues (
                issue_id INT AUTO_INCREMENT PRIMARY KEY,
                book_id INT NOT NULL,
                student_id INT NOT NULL,
                admin_id INT NOT NULL,
                issue_date DATE NOT NULL,
                due_date DATE NOT NULL,
                return_date DATE NULL,
                fine_amount DECIMAL(6,2) DEFAULT 0.00,
                status ENUM('Issued', 'Returned', 'Overdue') DEFAULT 'Issued',
                remarks VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT fk_issues_book 
                    FOREIGN KEY (book_id) REFERENCES books(book_id) 
                    ON DELETE RESTRICT ON UPDATE CASCADE,
                CONSTRAINT fk_issues_student 
                    FOREIGN KEY (student_id) REFERENCES students(student_id) 
                    ON DELETE RESTRICT ON UPDATE CASCADE,
                CONSTRAINT fk_issues_admin 
                    FOREIGN KEY (admin_id) REFERENCES admins(admin_id) 
                    ON DELETE RESTRICT ON UPDATE CASCADE,
                CONSTRAINT chk_issue_dates 
                    CHECK (due_date >= issue_date)
            ) ENGINE=InnoDB;
        `);
        console.log('   - Table `book_issues` created.');

        // Indexes on Book Issues
        await connection.query(`
            CREATE INDEX idx_issues_book ON book_issues(book_id);
            CREATE INDEX idx_issues_student ON book_issues(student_id);
            CREATE INDEX idx_issues_status ON book_issues(status);
        `);

        // 6. Audit Log Table
        await connection.query(`
            CREATE TABLE issue_audit_log (
                log_id INT AUTO_INCREMENT PRIMARY KEY,
                action_type VARCHAR(20) NOT NULL,
                issue_id INT NOT NULL,
                book_id INT NOT NULL,
                student_id INT NOT NULL,
                details VARCHAR(255),
                logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB;
        `);
        console.log('   - Table `issue_audit_log` created.');

        // 7. Views
        console.log('👁️ Creating Views...');
        await connection.query(`
            CREATE OR REPLACE VIEW v_active_issues AS
            SELECT 
                bi.issue_id,
                b.book_id,
                b.title AS book_title,
                b.isbn,
                s.student_id,
                s.roll_number,
                s.full_name AS student_name,
                s.email AS student_email,
                s.department,
                bi.issue_date,
                bi.due_date,
                DATEDIFF(CURRENT_DATE, bi.due_date) AS days_overdue,
                CASE 
                    WHEN CURRENT_DATE > bi.due_date THEN (DATEDIFF(CURRENT_DATE, bi.due_date) * 5.00)
                    ELSE 0.00 
                END AS estimated_fine,
                bi.status,
                a.full_name AS issued_by_admin
            FROM book_issues bi
            JOIN books b ON bi.book_id = b.book_id
            JOIN students s ON bi.student_id = s.student_id
            JOIN admins a ON bi.admin_id = a.admin_id
            WHERE bi.status IN ('Issued', 'Overdue');
        `);

        await connection.query(`
            CREATE OR REPLACE VIEW v_book_inventory AS
            SELECT 
                b.book_id,
                b.isbn,
                b.title,
                b.author,
                c.category_name,
                b.publisher,
                b.publish_year,
                b.total_copies,
                b.available_copies,
                (b.total_copies - b.available_copies) AS issued_copies,
                b.shelf_location,
                CASE 
                    WHEN b.available_copies > 0 THEN 'Available'
                    ELSE 'Out of Stock'
                END AS stock_status
            FROM books b
            JOIN categories c ON b.category_id = c.category_id;
        `);
        console.log('   - Views `v_active_issues` and `v_book_inventory` created.');

        // 8. Triggers
        console.log('⚡ Creating Triggers...');
        await connection.query(`
            DROP TRIGGER IF EXISTS trg_after_issue_insert;
        `);
        await connection.query(`
            CREATE TRIGGER trg_after_issue_insert
            AFTER INSERT ON book_issues
            FOR EACH ROW
            BEGIN
                INSERT INTO issue_audit_log (action_type, issue_id, book_id, student_id, details)
                VALUES ('ISSUE', NEW.issue_id, NEW.book_id, NEW.student_id, 
                        CONCAT('Book issued on ', NEW.issue_date, ' due on ', NEW.due_date));
            END;
        `);

        await connection.query(`
            DROP TRIGGER IF EXISTS trg_after_issue_update;
        `);
        await connection.query(`
            CREATE TRIGGER trg_after_issue_update
            AFTER UPDATE ON book_issues
            FOR EACH ROW
            BEGIN
                IF OLD.status != 'Returned' AND NEW.status = 'Returned' THEN
                    INSERT INTO issue_audit_log (action_type, issue_id, book_id, student_id, details)
                    VALUES ('RETURN', NEW.issue_id, NEW.book_id, NEW.student_id, 
                            CONCAT('Book returned on ', NEW.return_date, '. Fine: Rs ', NEW.fine_amount));
                END IF;
            END;
        `);
        console.log('   - Triggers created successfully.');

        // 9. Seed Data
        console.log('🌱 Inserting sample seed data...');

        // Password hashes
        const adminHash = await bcrypt.hash('admin123', 10);
        const studentHash = await bcrypt.hash('student123', 10);

        // Admins
        await connection.query(`
            INSERT INTO admins (admin_id, username, password_hash, full_name, email, role) VALUES
            (1, 'admin', ?, 'Dr. Rajesh Sharma', 'admin@library.edu', 'Chief Librarian'),
            (2, 'assistant', ?, 'Pooja Verma', 'pooja@library.edu', 'Assistant Librarian')
            ON DUPLICATE KEY UPDATE full_name=VALUES(full_name);
        `, [adminHash, adminHash]);

        // Categories
        await connection.query(`
            INSERT INTO categories (category_id, category_name, description) VALUES
            (1, 'Computer Science & Engineering', 'Core textbooks and references for CSE/IT students including OS, DBMS, Algorithms, and Architecture.'),
            (2, 'Data Science & Artificial Intelligence', 'Books covering Machine Learning, Neural Networks, Python, and Big Data Analytics.'),
            (3, 'Mathematics & Discrete Structures', 'Applied mathematics, probability, statistics, and discrete computational structures.'),
            (4, 'Electronics & Hardware', 'Digital electronics, microprocessors, and computer organization fundamentals.'),
            (5, 'Software Engineering & Web', 'Software life cycles, agile methodologies, clean architecture, and modern full-stack web engineering.')
            ON DUPLICATE KEY UPDATE category_name=VALUES(category_name);
        `);

        // Students
        await connection.query(`
            INSERT INTO students (student_id, roll_number, full_name, email, phone, department, semester, password_hash, status) VALUES
            (1, '23CS001', 'Aarav Patel', 'aarav.patel@college.edu', '9876543210', 'CSE', 4, ?, 'Active'),
            (2, '23CS015', 'Sneha Kulkarni', 'sneha.k@college.edu', '9876543211', 'CSE', 4, ?, 'Active'),
            (3, '23CS042', 'Rohan Gupta', 'rohan.gupta@college.edu', '9876543212', 'CSE', 4, ?, 'Active'),
            (4, '23CS088', 'Ananya Iyer', 'ananya.iyer@college.edu', '9876543213', 'CSE', 4, ?, 'Active'),
            (5, '23CS105', 'Vikram Singh', 'vikram.singh@college.edu', '9876543214', 'CSE', 4, ?, 'Blocked')
            ON DUPLICATE KEY UPDATE roll_number=VALUES(roll_number);
        `, [studentHash, studentHash, studentHash, studentHash, studentHash]);

        // Books
        await connection.query(`
            INSERT INTO books (book_id, isbn, title, author, category_id, publisher, publish_year, total_copies, available_copies, shelf_location) VALUES
            (1, '978-0078022159', 'Database System Concepts', 'Abraham Silberschatz, Henry F. Korth, S. Sudarshan', 1, 'McGraw-Hill Education', 2020, 6, 4, 'Rack-B1-01'),
            (2, '978-0133594140', 'Operating System Concepts', 'Abraham Silberschatz, Peter B. Galvin, Greg Gagne', 1, 'Wiley', 2018, 5, 4, 'Rack-B1-02'),
            (3, '978-0262033848', 'Introduction to Algorithms (CLRS)', 'Thomas H. Cormen, Charles E. Leiserson, Ronald L. Rivest, Clifford Stein', 1, 'MIT Press', 2009, 8, 7, 'Rack-B1-03'),
            (4, '978-0130661029', 'Computer Networks', 'Andrew S. Tanenbaum, David J. Wetherall', 1, 'Pearson', 2011, 4, 3, 'Rack-B1-04'),
            (5, '978-0134685991', 'Effective Java', 'Joshua Bloch', 5, 'Addison-Wesley', 2018, 4, 4, 'Rack-B2-01'),
            (6, '978-0132350884', 'Clean Code: A Handbook of Agile Software Craftsmanship', 'Robert C. Martin', 5, 'Prentice Hall', 2008, 5, 5, 'Rack-B2-02'),
            (7, '978-0136042594', 'Artificial Intelligence: A Modern Approach', 'Stuart Russell, Peter Norvig', 2, 'Pearson', 2020, 3, 2, 'Rack-B3-01'),
            (8, '978-1449369415', 'Python Data Science Handbook', 'Jake VanderPlas', 2, "O'Reilly Media", 2016, 4, 4, 'Rack-B3-02'),
            (9, '978-0073383095', 'Discrete Mathematics and Its Applications', 'Kenneth H. Rosen', 3, 'McGraw-Hill', 2019, 5, 5, 'Rack-B4-01'),
            (10, '978-0134547343', 'Digital Design: With an Introduction to Verilog HDL', 'M. Morris Mano, Michael D. Ciletti', 4, 'Pearson', 2017, 3, 3, 'Rack-B4-02')
            ON DUPLICATE KEY UPDATE isbn=VALUES(isbn);
        `);

        // Issues
        await connection.query(`
            INSERT INTO book_issues (issue_id, book_id, student_id, admin_id, issue_date, due_date, return_date, fine_amount, status, remarks) VALUES
            (1, 1, 1, 1, DATE_SUB(CURRENT_DATE, INTERVAL 20 DAY), DATE_SUB(CURRENT_DATE, INTERVAL 6 DAY), NULL, 30.00, 'Overdue', 'First notice sent to student'),
            (2, 2, 2, 1, DATE_SUB(CURRENT_DATE, INTERVAL 5 DAY), DATE_ADD(CURRENT_DATE, INTERVAL 9 DAY), NULL, 0.00, 'Issued', 'Mid-term study reference'),
            (3, 4, 1, 1, DATE_SUB(CURRENT_DATE, INTERVAL 2 DAY), DATE_ADD(CURRENT_DATE, INTERVAL 12 DAY), NULL, 0.00, 'Issued', 'Lab project assignment'),
            (4, 7, 3, 2, DATE_SUB(CURRENT_DATE, INTERVAL 30 DAY), DATE_SUB(CURRENT_DATE, INTERVAL 16 DAY), DATE_SUB(CURRENT_DATE, INTERVAL 15 DAY), 5.00, 'Returned', 'Returned with 1 day late fee paid'),
            (5, 3, 4, 1, DATE_SUB(CURRENT_DATE, INTERVAL 15 DAY), DATE_SUB(CURRENT_DATE, INTERVAL 1 DAY), DATE_SUB(CURRENT_DATE, INTERVAL 1 DAY), 0.00, 'Returned', 'Returned in pristine condition')
            ON DUPLICATE KEY UPDATE issue_id=VALUES(issue_id);
        `);

        console.log('✅ Database setup completed successfully!');
        console.log('\n=========================================');
        console.log('🔑 DEFAULT LOGIN CREDENTIALS:');
        console.log('   Admin:   admin    / admin123');
        console.log('   Student: 23CS001  / student123');
        console.log('=========================================\n');

    } catch (err) {
        console.error('❌ Database initialization error:', err.message);
        if (err.code === 'ECONNREFUSED') {
            console.error('\n⚠️  Could not connect to MySQL Server on ' + config.host + ':' + config.port);
            console.error('   Please ensure MySQL / XAMPP is started and running.\n');
        }
        process.exit(1);
    } finally {
        if (connection) await connection.end();
    }
}

initDatabase();
