-- ==============================================================================
-- PROJECT: Library Management System (DBMS Capstone)
-- Target: 2nd-Year B.Tech CSE Database Management Systems Lab & Course Project
-- Database Engine: MySQL (InnoDB)
-- ==============================================================================

-- Create Database if not exists
CREATE DATABASE IF NOT EXISTS `library_db` 
CHARACTER SET utf8mb4 
COLLATE utf8mb4_unicode_ci;

USE `library_db`;

-- Temporarily disable foreign key checks for clean recreation
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS `issue_audit_log`;
DROP TABLE IF EXISTS `book_issues`;
DROP TABLE IF EXISTS `books`;
DROP TABLE IF EXISTS `students`;
DROP TABLE IF EXISTS `categories`;
DROP TABLE IF EXISTS `admins`;

SET FOREIGN_KEY_CHECKS = 1;

-- ==============================================================================
-- 1. TABLE: admins
-- Stores library staff and administrative credentials
-- ==============================================================================
CREATE TABLE `admins` (
    `admin_id` INT AUTO_INCREMENT PRIMARY KEY,
    `username` VARCHAR(50) NOT NULL UNIQUE,
    `password_hash` VARCHAR(255) NOT NULL,
    `full_name` VARCHAR(100) NOT NULL,
    `email` VARCHAR(100) NOT NULL UNIQUE,
    `role` VARCHAR(50) DEFAULT 'Librarian',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ==============================================================================
-- 2. TABLE: categories
-- Normalizes book subjects/genres to ensure 2NF & 3NF
-- ==============================================================================
CREATE TABLE `categories` (
    `category_id` INT AUTO_INCREMENT PRIMARY KEY,
    `category_name` VARCHAR(100) NOT NULL UNIQUE,
    `description` TEXT,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ==============================================================================
-- 3. TABLE: students
-- Stores registered college students with CSE details
-- ==============================================================================
CREATE TABLE `students` (
    `student_id` INT AUTO_INCREMENT PRIMARY KEY,
    `roll_number` VARCHAR(30) NOT NULL UNIQUE,
    `full_name` VARCHAR(100) NOT NULL,
    `email` VARCHAR(100) NOT NULL UNIQUE,
    `phone` VARCHAR(15),
    `department` VARCHAR(50) DEFAULT 'CSE',
    `semester` INT DEFAULT 4,
    `password_hash` VARCHAR(255) NOT NULL,
    `status` ENUM('Active', 'Blocked') DEFAULT 'Active',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ==============================================================================
-- 4. TABLE: books
-- Master catalog of books in the library
-- Demonstrates Foreign Key constraint and CHECK constraint
-- ==============================================================================
CREATE TABLE `books` (
    `book_id` INT AUTO_INCREMENT PRIMARY KEY,
    `isbn` VARCHAR(20) NOT NULL UNIQUE,
    `title` VARCHAR(200) NOT NULL,
    `author` VARCHAR(150) NOT NULL,
    `category_id` INT NOT NULL,
    `publisher` VARCHAR(100),
    `publish_year` INT,
    `total_copies` INT NOT NULL DEFAULT 1,
    `available_copies` INT NOT NULL DEFAULT 1,
    `shelf_location` VARCHAR(50) DEFAULT 'Shelf-A1',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_books_category` 
        FOREIGN KEY (`category_id`) REFERENCES `categories`(`category_id`) 
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `chk_book_copies` 
        CHECK (`available_copies` <= `total_copies` AND `available_copies` >= 0)
) ENGINE=InnoDB;

-- Indexes on books for search performance (Unit 2 & 4)
CREATE INDEX `idx_books_category` ON `books`(`category_id`);
CREATE INDEX `idx_books_title` ON `books`(`title`);
CREATE INDEX `idx_books_author` ON `books`(`author`);

-- ==============================================================================
-- 5. TABLE: book_issues
-- Transaction table capturing lending activity, due dates, and returns
-- Demonstrates Composite Foreign Keys & Check constraints
-- ==============================================================================
CREATE TABLE `book_issues` (
    `issue_id` INT AUTO_INCREMENT PRIMARY KEY,
    `book_id` INT NOT NULL,
    `student_id` INT NOT NULL,
    `admin_id` INT NOT NULL,
    `issue_date` DATE NOT NULL,
    `due_date` DATE NOT NULL,
    `return_date` DATE NULL,
    `fine_amount` DECIMAL(6,2) DEFAULT 0.00,
    `status` ENUM('Issued', 'Returned', 'Overdue') DEFAULT 'Issued',
    `remarks` VARCHAR(255),
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_issues_book` 
        FOREIGN KEY (`book_id`) REFERENCES `books`(`book_id`) 
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `fk_issues_student` 
        FOREIGN KEY (`student_id`) REFERENCES `students`(`student_id`) 
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `fk_issues_admin` 
        FOREIGN KEY (`admin_id`) REFERENCES `admins`(`admin_id`) 
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `chk_issue_dates` 
        CHECK (`due_date` >= `issue_date`)
) ENGINE=InnoDB;

-- Indexes on book_issues for join & filter performance
CREATE INDEX `idx_issues_book` ON `book_issues`(`book_id`);
CREATE INDEX `idx_issues_student` ON `book_issues`(`student_id`);
CREATE INDEX `idx_issues_status` ON `book_issues`(`status`);

-- ==============================================================================
-- 6. TABLE: issue_audit_log
-- Audit trail table updated automatically via triggers (Unit 3)
-- ==============================================================================
CREATE TABLE `issue_audit_log` (
    `log_id` INT AUTO_INCREMENT PRIMARY KEY,
    `action_type` VARCHAR(20) NOT NULL, -- 'ISSUE', 'RETURN'
    `issue_id` INT NOT NULL,
    `book_id` INT NOT NULL,
    `student_id` INT NOT NULL,
    `details` VARCHAR(255),
    `logged_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ==============================================================================
-- 7. VIEWS (Unit 2 Syllabus Requirement)
-- ==============================================================================

-- View: Active Issues with Student and Book details
CREATE OR REPLACE VIEW `v_active_issues` AS
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
FROM `book_issues` bi
JOIN `books` b ON bi.book_id = b.book_id
JOIN `students` s ON bi.student_id = s.student_id
JOIN `admins` a ON bi.admin_id = a.admin_id
WHERE bi.status IN ('Issued', 'Overdue');

-- View: Book Inventory status including issued counts
CREATE OR REPLACE VIEW `v_book_inventory` AS
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
FROM `books` b
JOIN `categories` c ON b.category_id = c.category_id;

-- ==============================================================================
-- 8. STORED FUNCTION (Unit 3: Function for fine calculation)
-- Calculates late return fine at ₹5 per day
-- ==============================================================================
DELIMITER $$

DROP FUNCTION IF EXISTS `fn_calculate_fine`$$
CREATE FUNCTION `fn_calculate_fine`(p_due_date DATE, p_return_date DATE) 
RETURNS DECIMAL(6,2)
DETERMINISTIC
BEGIN
    DECLARE overdue_days INT;
    DECLARE daily_rate DECIMAL(4,2) DEFAULT 5.00;
    
    IF p_return_date IS NULL THEN
        SET overdue_days = DATEDIFF(CURRENT_DATE, p_due_date);
    ELSE
        SET overdue_days = DATEDIFF(p_return_date, p_due_date);
    END IF;
    
    IF overdue_days > 0 THEN
        RETURN overdue_days * daily_rate;
    ELSE
        RETURN 0.00;
    END IF;
END$$

-- ==============================================================================
-- 9. STORED PROCEDURES (Unit 3: Transaction management with ACID)
-- ==============================================================================

-- Stored Procedure: Issue a book safely with ACID transaction
DROP PROCEDURE IF EXISTS `sp_issue_book`$$
CREATE PROCEDURE `sp_issue_book`(
    IN p_book_id INT,
    IN p_student_id INT,
    IN p_admin_id INT,
    IN p_days INT,
    OUT p_status_code INT, -- 1: Success, 0: Out of stock/Inactive, -1: Error
    OUT p_message VARCHAR(255)
)
proc_label: BEGIN
    DECLARE v_available INT DEFAULT 0;
    DECLARE v_student_status VARCHAR(20);
    DECLARE v_due_date DATE;
    
    -- Error Handler for transaction rollback
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        SET p_status_code = -1;
        SET p_message = 'Database error during book issue transaction. Changes rolled back.';
    END;

    START TRANSACTION;
    
    -- 1. Check if student is active
    SELECT status INTO v_student_status FROM students WHERE student_id = p_student_id;
    IF v_student_status IS NULL OR v_student_status != 'Active' THEN
        ROLLBACK;
        SET p_status_code = 0;
        SET p_message = 'Cannot issue book: Student account is blocked or inactive.';
        LEAVE proc_label;
    END IF;

    -- 2. Check book availability (lock row for update to prevent race conditions)
    SELECT available_copies INTO v_available FROM books WHERE book_id = p_book_id FOR UPDATE;
    IF v_available <= 0 THEN
        ROLLBACK;
        SET p_status_code = 0;
        SET p_message = 'Cannot issue book: No available copies in library stock.';
        LEAVE proc_label;
    END IF;

    -- 3. Calculate due date
    SET v_due_date = DATE_ADD(CURRENT_DATE, INTERVAL p_days DAY);

    -- 4. Insert into book_issues table
    INSERT INTO book_issues (book_id, student_id, admin_id, issue_date, due_date, status)
    VALUES (p_book_id, p_student_id, p_admin_id, CURRENT_DATE, v_due_date, 'Issued');

    -- 5. Decrement available copies in books catalog
    UPDATE books 
    SET available_copies = available_copies - 1 
    WHERE book_id = p_book_id;

    COMMIT;
    SET p_status_code = 1;
    SET p_message = 'Book issued successfully!';
END$$

-- Stored Procedure: Return a book safely with fine calculation
DROP PROCEDURE IF EXISTS `sp_return_book`$$
CREATE PROCEDURE `sp_return_book`(
    IN p_issue_id INT,
    OUT p_fine DECIMAL(6,2),
    OUT p_status_code INT,
    OUT p_message VARCHAR(255)
)
proc_label: BEGIN
    DECLARE v_book_id INT;
    DECLARE v_due_date DATE;
    DECLARE v_current_status VARCHAR(20);
    DECLARE v_calculated_fine DECIMAL(6,2) DEFAULT 0.00;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        SET p_status_code = -1;
        SET p_message = 'Database error during book return transaction. Rolled back.';
    END;

    START TRANSACTION;

    SELECT book_id, due_date, status 
    INTO v_book_id, v_due_date, v_current_status 
    FROM book_issues 
    WHERE issue_id = p_issue_id FOR UPDATE;

    IF v_book_id IS NULL THEN
        ROLLBACK;
        SET p_status_code = 0;
        SET p_message = 'Issue record not found.';
        LEAVE proc_label;
    END IF;

    IF v_current_status = 'Returned' THEN
        ROLLBACK;
        SET p_status_code = 0;
        SET p_message = 'This book has already been marked as returned.';
        LEAVE proc_label;
    END IF;

    -- Calculate fine using stored function
    SET v_calculated_fine = fn_calculate_fine(v_due_date, CURRENT_DATE);
    SET p_fine = v_calculated_fine;

    -- Update issue record
    UPDATE book_issues 
    SET return_date = CURRENT_DATE,
        fine_amount = v_calculated_fine,
        status = 'Returned'
    WHERE issue_id = p_issue_id;

    -- Increment available copies in catalog
    UPDATE books 
    SET available_copies = available_copies + 1 
    WHERE book_id = v_book_id;

    COMMIT;
    SET p_status_code = 1;
    SET p_message = CONCAT('Book returned successfully. Fine: Rs ', v_calculated_fine);
END$$

-- Stored Procedure: Cursor demonstration for Overdue Books (Unit 3)
DROP PROCEDURE IF EXISTS `sp_process_overdue_fines`$$
CREATE PROCEDURE `sp_process_overdue_fines`()
BEGIN
    DECLARE done INT DEFAULT FALSE;
    DECLARE v_issue_id INT;
    DECLARE v_due_date DATE;
    DECLARE v_calculated_fine DECIMAL(6,2);
    
    -- Cursor declaration
    DECLARE cur_overdue CURSOR FOR 
        SELECT issue_id, due_date 
        FROM book_issues 
        WHERE status = 'Issued' AND due_date < CURRENT_DATE;
        
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    OPEN cur_overdue;

    read_loop: LOOP
        FETCH cur_overdue INTO v_issue_id, v_due_date;
        IF done THEN
            LEAVE read_loop;
        END IF;

        SET v_calculated_fine = fn_calculate_fine(v_due_date, CURRENT_DATE);

        -- Update fine and status
        UPDATE book_issues 
        SET status = 'Overdue',
            fine_amount = v_calculated_fine
        WHERE issue_id = v_issue_id;
    END LOOP;

    CLOSE cur_overdue;
END$$

-- ==============================================================================
-- 10. TRIGGERS (Unit 3: Automated database audit logs)
-- ==============================================================================

-- Trigger: When a book issue record is created
DROP TRIGGER IF EXISTS `trg_after_issue_insert`$$
CREATE TRIGGER `trg_after_issue_insert`
AFTER INSERT ON `book_issues`
FOR EACH ROW
BEGIN
    INSERT INTO `issue_audit_log` (action_type, issue_id, book_id, student_id, details)
    VALUES ('ISSUE', NEW.issue_id, NEW.book_id, NEW.student_id, 
            CONCAT('Book issued on ', NEW.issue_date, ' with due date ', NEW.due_date));
END$$

-- Trigger: When a book is returned
DROP TRIGGER IF EXISTS `trg_after_issue_update`$$
CREATE TRIGGER `trg_after_issue_update`
AFTER UPDATE ON `book_issues`
FOR EACH ROW
BEGIN
    IF OLD.status != 'Returned' AND NEW.status = 'Returned' THEN
        INSERT INTO `issue_audit_log` (action_type, issue_id, book_id, student_id, details)
        VALUES ('RETURN', NEW.issue_id, NEW.book_id, NEW.student_id, 
                CONCAT('Book returned on ', NEW.return_date, '. Fine: Rs ', NEW.fine_amount));
    END IF;
END$$

DELIMITER ;

-- ==============================================================================
-- 11. SAMPLE SEED DATA
-- Passwords:
-- Admin: admin / admin123
-- Student: CSE001 to CSE004 / student123
-- ==============================================================================

-- Admins (Password: admin123)
INSERT INTO `admins` (`admin_id`, `username`, `password_hash`, `full_name`, `email`, `role`) VALUES
(1, 'admin', '$2b$10$0DqHFrZ5u0.1vZPYdQyCpOun66zXqj2rKrZ16I1gW5mfmuxBi84.K', 'Dr. Rajesh Sharma', 'admin@library.edu', 'Chief Librarian'),
(2, 'assistant', '$2b$10$0DqHFrZ5u0.1vZPYdQyCpOun66zXqj2rKrZ16I1gW5mfmuxBi84.K', 'Pooja Verma', 'pooja@library.edu', 'Assistant Librarian');

-- Categories
INSERT INTO `categories` (`category_id`, `category_name`, `description`) VALUES
(1, 'Computer Science & Engineering', 'Core textbooks and references for CSE/IT students including OS, DBMS, Algorithms, and Architecture.'),
(2, 'Data Science & Artificial Intelligence', 'Books covering Machine Learning, Neural Networks, Python, and Big Data Analytics.'),
(3, 'Mathematics & Discrete Structures', 'Applied mathematics, probability, statistics, and discrete computational structures.'),
(4, 'Electronics & Hardware', 'Digital electronics, microprocessors, and computer organization fundamentals.'),
(5, 'Software Engineering & Web', 'Software life cycles, agile methodologies, clean architecture, and modern full-stack web engineering.');

-- Students (Password: student123)
INSERT INTO `students` (`student_id`, `roll_number`, `full_name`, `email`, `phone`, `department`, `semester`, `password_hash`, `status`) VALUES
(1, '23CS001', 'Aarav Patel', 'aarav.patel@college.edu', '9876543210', 'CSE', 4, '$2b$10$1PQIn4.PnGIVM5ESnAndc.OheEiHy.YqdLfg88XQ5gJwANi9Dv/L.', 'Active'),
(2, '23CS015', 'Sneha Kulkarni', 'sneha.k@college.edu', '9876543211', 'CSE', 4, '$2b$10$1PQIn4.PnGIVM5ESnAndc.OheEiHy.YqdLfg88XQ5gJwANi9Dv/L.', 'Active'),
(3, '23CS042', 'Rohan Gupta', 'rohan.gupta@college.edu', '9876543212', 'CSE', 4, '$2b$10$1PQIn4.PnGIVM5ESnAndc.OheEiHy.YqdLfg88XQ5gJwANi9Dv/L.', 'Active'),
(4, '23CS088', 'Ananya Iyer', 'ananya.iyer@college.edu', '9876543213', 'CSE', 4, '$2b$10$1PQIn4.PnGIVM5ESnAndc.OheEiHy.YqdLfg88XQ5gJwANi9Dv/L.', 'Active'),
(5, '23CS105', 'Vikram Singh', 'vikram.singh@college.edu', '9876543214', 'CSE', 4, '$2b$10$1PQIn4.PnGIVM5ESnAndc.OheEiHy.YqdLfg88XQ5gJwANi9Dv/L.', 'Blocked');

-- Books Catalog
INSERT INTO `books` (`book_id`, `isbn`, `title`, `author`, `category_id`, `publisher`, `publish_year`, `total_copies`, `available_copies`, `shelf_location`) VALUES
(1, '978-0078022159', 'Database System Concepts', 'Abraham Silberschatz, Henry F. Korth, S. Sudarshan', 1, 'McGraw-Hill Education', 2020, 6, 4, 'Rack-B1-01'),
(2, '978-0133594140', 'Operating System Concepts', 'Abraham Silberschatz, Peter B. Galvin, Greg Gagne', 1, 'Wiley', 2018, 5, 4, 'Rack-B1-02'),
(3, '978-0262033848', 'Introduction to Algorithms (CLRS)', 'Thomas H. Cormen, Charles E. Leiserson, Ronald L. Rivest, Clifford Stein', 1, 'MIT Press', 2009, 8, 7, 'Rack-B1-03'),
(4, '978-0130661029', 'Computer Networks', 'Andrew S. Tanenbaum, David J. Wetherall', 1, 'Pearson', 2011, 4, 3, 'Rack-B1-04'),
(5, '978-0134685991', 'Effective Java', 'Joshua Bloch', 5, 'Addison-Wesley', 2018, 4, 4, 'Rack-B2-01'),
(6, '978-0132350884', 'Clean Code: A Handbook of Agile Software Craftsmanship', 'Robert C. Martin', 5, 'Prentice Hall', 2008, 5, 5, 'Rack-B2-02'),
(7, '978-0136042594', 'Artificial Intelligence: A Modern Approach', 'Stuart Russell, Peter Norvig', 2, 'Pearson', 2020, 3, 2, 'Rack-B3-01'),
(8, '978-1449369415', 'Python Data Science Handbook', 'Jake VanderPlas', 2, "O'Reilly Media", 2016, 4, 4, 'Rack-B3-02'),
(9, '978-0073383095', 'Discrete Mathematics and Its Applications', 'Kenneth H. Rosen', 3, 'McGraw-Hill', 2019, 5, 5, 'Rack-B4-01'),
(10, '978-0134547343', 'Digital Design: With an Introduction to Verilog HDL', 'M. Morris Mano, Michael D. Ciletti', 4, 'Pearson', 2017, 3, 3, 'Rack-B4-02');

-- Seed Book Issues (Simulating active, returned, and overdue books)
INSERT INTO `book_issues` (`issue_id`, `book_id`, `student_id`, `admin_id`, `issue_date`, `due_date`, `return_date`, `fine_amount`, `status`, `remarks`) VALUES
(1, 1, 1, 1, DATE_SUB(CURRENT_DATE, INTERVAL 20 DAY), DATE_SUB(CURRENT_DATE, INTERVAL 6 DAY), NULL, 30.00, 'Overdue', 'First notice sent to student'),
(2, 2, 2, 1, DATE_SUB(CURRENT_DATE, INTERVAL 5 DAY), DATE_ADD(CURRENT_DATE, INTERVAL 9 DAY), NULL, 0.00, 'Issued', 'Mid-term study reference'),
(3, 4, 1, 1, DATE_SUB(CURRENT_DATE, INTERVAL 2 DAY), DATE_ADD(CURRENT_DATE, INTERVAL 12 DAY), NULL, 0.00, 'Issued', 'Lab project assignment'),
(4, 7, 3, 2, DATE_SUB(CURRENT_DATE, INTERVAL 30 DAY), DATE_SUB(CURRENT_DATE, INTERVAL 16 DAY), DATE_SUB(CURRENT_DATE, INTERVAL 15 DAY), 5.00, 'Returned', 'Returned with 1 day late fee paid'),
(5, 3, 4, 1, DATE_SUB(CURRENT_DATE, INTERVAL 15 DAY), DATE_SUB(CURRENT_DATE, INTERVAL 1 DAY), DATE_SUB(CURRENT_DATE, INTERVAL 1 DAY), 0.00, 'Returned', 'Returned in pristine condition');
