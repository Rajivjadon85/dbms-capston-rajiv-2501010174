-- ==============================================================================
-- 📚 DBMS SYLLABUS COMPREHENSIVE QUERY SUITE & LAB REFERENCE
-- Project: Library Management System
-- Course: Database Management Systems (2nd-Year B.Tech CSE)
-- Target RDBMS: MySQL 8.0+
-- ==============================================================================
-- This file provides executable queries and annotated academic explanations
-- covering the complete university syllabus across Units 1, 2, 3, and 4.
-- ==============================================================================

USE `library_db`;

-- ##############################################################################
-- 📌 UNIT 1: DATABASE DESIGN & RELATIONAL DATA MODEL
-- ##############################################################################

-- 1.1 Relational Schema Definitions
-- Notation: TableName(Primary_Key, Attribute1, Attribute2, Foreign_Key*)
-- Admins(admin_id, username, password_hash, full_name, email, role, created_at)
-- Categories(category_id, category_name, description, created_at)
-- Students(student_id, roll_number, full_name, email, phone, department, semester, password_hash, status, created_at)
-- Books(book_id, isbn, title, author, category_id*, publisher, publish_year, total_copies, available_copies, shelf_location, created_at)
-- Book_Issues(issue_id, book_id*, student_id*, admin_id*, issue_date, due_date, return_date, fine_amount, status, remarks, created_at)

-- 1.2 Keys in Database Management Systems:
-- Super Key: Any attribute set that uniquely identifies a row (e.g., {student_id}, {student_id, roll_number}, {email, phone})
-- Candidate Key: Minimal super key with no extraneous attributes (e.g., student_id, roll_number, email)
-- Primary Key: Chosen candidate key by the DBA to uniquely identify tuples (e.g., student_id)
-- Alternate Key: Candidate keys not chosen as the Primary Key (e.g., roll_number, email)
-- Foreign Key: Attribute referencing the Primary Key of another table (e.g., category_id in Books references Categories)
-- Composite Key: Key made up of two or more attributes (e.g., {book_id, student_id, issue_date})

-- 1.3 Integrity Constraints Verification:
-- 1. Domain Constraint: Ensuring valid data types & values
INSERT INTO categories (category_name, description) VALUES ('Cloud Computing', 'AWS, Azure, and GCP distributed architectures');

-- 2. Entity Integrity: Primary Key cannot be NULL and must be unique
-- The following will fail if uncommented:
-- INSERT INTO students (student_id, roll_number, full_name, email, password_hash) VALUES (NULL, '23CS999', 'Test', 'test@college.edu', 'hash');

-- 3. Referential Integrity: Foreign Key must match an existing Primary Key
-- The following will fail with foreign key violation:
-- INSERT INTO books (isbn, title, author, category_id) VALUES ('999-00000', 'Invalid Book', 'Author', 999);

-- 4. Check Constraint: Ensuring logical rules (available_copies <= total_copies AND >= 0)
-- The following will fail with check constraint violation:
-- UPDATE books SET available_copies = 100 WHERE book_id = 1;

-- 1.4 Functional Dependencies (FDs) & Normalization:
-- Let Book_Catalog_Unnormalized = (book_id, isbn, title, author, category_id, category_name, category_desc, student_id, roll_number, student_name, issue_date)
-- FDs:
-- FD1: book_id -> isbn, title, author, category_id
-- FD2: category_id -> category_name, category_desc
-- FD3: student_id -> roll_number, student_name
-- FD4: {book_id, student_id, issue_date} -> due_date, status

-- 1NF (First Normal Form):
-- Rule: Every attribute must hold only atomic (indivisible) values. No repeating groups or multivalued attributes.
-- Example: author attribute storing multiple authors ('Silberschatz, Korth') can be separated into Book_Authors table for strict 1NF.

-- 2NF (Second Normal Form):
-- Rule: Must be in 1NF AND no Partial Functional Dependency (non-prime attributes must depend on the WHOLE candidate key, not a proper subset).
-- In unnormalized relation with composite key {book_id, student_id, issue_date}:
-- title depends only on book_id (Partial Dependency) -> Violated 2NF!
-- Solution: Decompose into Books, Students, and Book_Issues tables.

-- 3NF (Third Normal Form):
-- Rule: Must be in 2NF AND no Transitive Dependency: For any FD X -> Y, either X is a super key or Y is a prime attribute.
-- If Books contained (book_id, title, category_id, category_name):
-- book_id -> category_id, and category_id -> category_name (Transitive Dependency).
-- Solution: Extract Categories into a separate table: Categories(category_id, category_name, description).

-- BCNF (Boyce-Codd Normal Form):
-- Rule: For EVERY functional dependency X -> Y, X MUST be a Super Key.
-- Stronger than 3NF (eliminates anomalies where a prime attribute is determined by a non-super key).
-- Our decomposed schema satisfies BCNF because the LHS of every FD is a Super Key (book_id, student_id, category_id, issue_id).

-- 1.5 Star Schema and Snowflake Schema Examples (Data Warehousing / Analytics):
-- STAR SCHEMA:
-- Fact Table: Fact_Book_Issues(issue_fact_id, book_key, student_key, date_key, category_key, duration_days, fine_collected)
-- Dimension Tables: Dim_Books, Dim_Students, Dim_Dates, Dim_Categories (Denormalized)

-- SNOWFLAKE SCHEMA:
-- Normalizes dimension tables. For example:
-- Dim_Books references Dim_Publishers(publisher_id, publisher_name, country)
-- and Dim_Categories references Dim_Departments(dept_id, dept_name).


-- ##############################################################################
-- 📌 UNIT 2: ADVANCED SQL (DDL, DML, DCL, TCL, JOINS, VIEWS, INDEXES, CTES)
-- ##############################################################################

-- 2.1 DDL (Data Definition Language)
-- Creating a temporary table for demonstration
CREATE TABLE IF NOT EXISTS `temp_book_archive` (
    `archive_id` INT AUTO_INCREMENT PRIMARY KEY,
    `book_title` VARCHAR(200),
    `archived_date` DATE
);

-- ALTER: Add a column
ALTER TABLE `temp_book_archive` ADD COLUMN `notes` VARCHAR(100) DEFAULT 'Standard Archive';

-- TRUNCATE: Remove all rows without dropping structure
TRUNCATE TABLE `temp_book_archive`;

-- DROP: Remove table
DROP TABLE `temp_book_archive`;

-- 2.2 DML (Data Manipulation Language)
-- SELECT with WHERE, ORDER BY, and LIMIT
SELECT title, author, available_copies 
FROM books 
WHERE available_copies > 2 
ORDER BY title ASC 
LIMIT 5;

-- 2.3 JOINS:
-- 1. INNER JOIN: Retrieve only issued books with student and book details
SELECT 
    bi.issue_id,
    s.roll_number,
    s.full_name AS student_name,
    b.title AS book_title,
    bi.issue_date,
    bi.due_date
FROM book_issues bi
INNER JOIN students s ON bi.student_id = s.student_id
INNER JOIN books b ON bi.book_id = b.book_id;

-- 2. LEFT JOIN: All books, including those never issued
SELECT 
    b.book_id,
    b.title,
    c.category_name,
    COUNT(bi.issue_id) AS total_times_borrowed
FROM books b
LEFT JOIN categories c ON b.category_id = c.category_id
LEFT JOIN book_issues bi ON b.book_id = bi.book_id
GROUP BY b.book_id, b.title, c.category_name
ORDER BY total_times_borrowed DESC;

-- 3. RIGHT JOIN: All categories and their associated books
SELECT 
    c.category_name,
    b.title,
    b.available_copies
FROM books b
RIGHT JOIN categories c ON b.category_id = c.category_id;

-- 4. SELF JOIN: Comparing books in the same category published in the same year or later
SELECT 
    b1.title AS original_book,
    b2.title AS related_category_book,
    b1.category_id,
    b1.publish_year
FROM books b1
JOIN books b2 ON b1.category_id = b2.category_id AND b1.book_id <> b2.book_id
LIMIT 5;

-- 2.4 SUBQUERIES AND SET OPERATIONS:
-- 1. Subquery in WHERE clause (Find students who have borrowed CSE category books)
SELECT full_name, email, roll_number 
FROM students 
WHERE student_id IN (
    SELECT bi.student_id 
    FROM book_issues bi
    JOIN books b ON bi.book_id = b.book_id
    WHERE b.category_id = 1
);

-- 2. Correlated Subquery with EXISTS (Find books that have at least one active issue)
SELECT b.book_id, b.title, b.author 
FROM books b
WHERE EXISTS (
    SELECT 1 
    FROM book_issues bi 
    WHERE bi.book_id = b.book_id AND bi.status = 'Issued'
);

-- 3. Scalar Subquery (Calculate percentage of total library copies for each book)
SELECT 
    title, 
    total_copies,
    ROUND((total_copies / (SELECT SUM(total_copies) FROM books)) * 100, 2) AS percentage_of_total_stock
FROM books;

-- 4. Set Operations: UNION (Combines distinct names of students and library admins)
SELECT full_name AS person_name, email, 'Student' AS user_type FROM students
UNION
SELECT full_name AS person_name, email, 'Admin' AS user_type FROM admins;

-- 2.5 VIEWS AND INDEXES:
-- Querying existing Views created in schema
SELECT * FROM v_active_issues;
SELECT * FROM v_book_inventory WHERE available_copies > 0;

-- Index performance demonstration
SHOW INDEX FROM books;

-- 2.6 CTE (Common Table Expression) and Window Functions:
-- CTE: Active borrowings aggregated by student
WITH StudentBorrowingSummary AS (
    SELECT 
        s.student_id,
        s.roll_number,
        s.full_name,
        COUNT(bi.issue_id) AS total_borrowed,
        SUM(CASE WHEN bi.status = 'Issued' THEN 1 ELSE 0 END) AS currently_holding,
        COALESCE(SUM(bi.fine_amount), 0.00) AS total_fines
    FROM students s
    LEFT JOIN book_issues bi ON s.student_id = bi.student_id
    GROUP BY s.student_id, s.roll_number, s.full_name
)
SELECT * FROM StudentBorrowingSummary WHERE total_borrowed > 0;

-- Window Functions: ROW_NUMBER(), RANK(), DENSE_RANK() by book popularity
SELECT 
    b.book_id,
    b.title,
    c.category_name,
    COUNT(bi.issue_id) AS borrow_count,
    ROW_NUMBER() OVER (PARTITION BY b.category_id ORDER BY COUNT(bi.issue_id) DESC) AS rank_in_category,
    DENSE_RANK() OVER (ORDER BY COUNT(bi.issue_id) DESC) AS overall_popularity_rank
FROM books b
JOIN categories c ON b.category_id = c.category_id
LEFT JOIN book_issues bi ON b.book_id = bi.book_id
GROUP BY b.book_id, b.title, c.category_name;


-- ##############################################################################
-- 📌 UNIT 3: TRANSACTIONS, PROCEDURES, FUNCTIONS, TRIGGERS & SECURITY
-- ##############################################################################

-- 3.1 ACID Properties in Database Transactions:
-- A - Atomicity: Either all steps of book issue complete or none do (ROLLBACK).
-- C - Consistency: Database transitions from one valid state to another (constraints enforced).
-- I - Isolation: Concurrent issues don't read dirty data (Row-level locking via FOR UPDATE).
-- D - Durability: Once committed, issued records persist even in server crashes (WAL / redo logs).

-- 3.2 Transaction Control Language (TCL) Simulation with SAVEPOINT:
START TRANSACTION;

-- Step 1: Update available copies
UPDATE books SET available_copies = available_copies - 1 WHERE book_id = 5;

-- Create Savepoint
SAVEPOINT step1_reserved;

-- Step 2: Attempt another update
UPDATE books SET available_copies = available_copies - 1 WHERE book_id = 6;

-- Rollback to Savepoint (cancels Step 2, keeps Step 1)
ROLLBACK TO step1_reserved;

-- Final Rollback to leave database untouched
ROLLBACK;

-- 3.3 Executing Stored Procedure & Function:
-- Testing Stored Procedure: Issue a book safely
SET @status_code = 0;
SET @status_msg = '';
CALL sp_issue_book(5, 2, 1, 14, @status_code, @status_msg);
SELECT @status_code AS issue_result_code, @status_msg AS issue_message;

-- Testing Stored Procedure: Return a book safely
SET @fine_out = 0.00;
SET @ret_code = 0;
SET @ret_msg = '';
-- Assuming issue_id 2 is active
-- CALL sp_return_book(2, @fine_out, @ret_code, @ret_msg);
-- SELECT @fine_out AS fine_assessed, @ret_code AS return_code, @ret_msg AS return_message;

-- Testing Stored Function: Calculate fine
SELECT fn_calculate_fine('2026-03-01', '2026-03-08') AS calculated_fine_rupees;

-- Testing Cursor Procedure: Process overdue fines across all active issues
CALL sp_process_overdue_fines();

-- Checking Audit Log Trigger entries
SELECT * FROM issue_audit_log ORDER BY logged_at DESC LIMIT 5;

-- 3.4 Database Security & User Privileges (DCL: Data Control Language):
-- Creating restricted database user for student portal (Read-only on books, read on their own issues)
-- CREATE USER IF NOT EXISTS 'student_user'@'localhost' IDENTIFIED BY 'StudentPass@123';
-- GRANT SELECT ON library_db.books TO 'student_user'@'localhost';
-- GRANT SELECT ON library_db.categories TO 'student_user'@'localhost';
-- GRANT SELECT ON library_db.v_book_inventory TO 'student_user'@'localhost';
-- FLUSH PRIVILEGES;

-- 3.5 Prepared Statements (Defense against SQL Injection):
-- In raw SQL:
PREPARE stmt_search_books FROM 'SELECT book_id, title, author, available_copies FROM books WHERE title LIKE ? AND category_id = ?';
SET @search_term = '%Database%';
SET @cat_id = 1;
EXECUTE stmt_search_books USING @search_term, @cat_id;
DEALLOCATE PREPARE stmt_search_books;


-- ##############################################################################
-- 📌 UNIT 4: QUERY PERFORMANCE, INDEXING & NOSQL CONCEPTS
-- ##############################################################################

-- 4.1 Query Optimization using EXPLAIN and Execution Plans:
-- Explain how MySQL plans to execute the book search query
EXPLAIN SELECT b.title, b.author, c.category_name 
FROM books b 
JOIN categories c ON b.category_id = c.category_id 
WHERE b.title LIKE 'Data%';

-- EXPLAIN ANALYZE (MySQL 8.0+) shows actual execution time and rows scanned:
EXPLAIN ANALYZE 
SELECT bi.issue_id, s.roll_number, b.title 
FROM book_issues bi
JOIN students s ON bi.student_id = s.student_id
JOIN books b ON bi.book_id = b.book_id
WHERE bi.status = 'Issued';

-- 4.2 B-Tree vs Hash Indexing:
-- B-Tree Index (Default in InnoDB):
-- - Balanced tree data structure where leaf nodes are sorted and linked.
-- - Ideal for range queries (WHERE publish_year BETWEEN 2010 AND 2020), sorting (ORDER BY), and prefix matching (LIKE 'Data%').
-- Hash Index:
-- - Uses a hash function to map keys to bucket pointers.
-- - O(1) time complexity for exact lookups (WHERE isbn = '978-0078022159').
-- - Ineffective for range queries, sorting, or prefix matching.

-- 4.3 NoSQL Schema Modeling Examples (Academic Reference):
-- Example 1: MongoDB Document Model (JSON / BSON)
/*
{
  "_id": ObjectId("64f1a2b3c4d5e6f7a8b9c0d1"),
  "isbn": "978-0078022159",
  "title": "Database System Concepts",
  "authors": ["Abraham Silberschatz", "Henry F. Korth", "S. Sudarshan"],
  "category": {
    "name": "Computer Science & Engineering",
    "department": "CSE"
  },
  "inventory": {
    "total": 6,
    "available": 4,
    "location": "Rack-B1-01"
  },
  "current_issues": [
    {
      "student_roll": "23CS001",
      "student_name": "Aarav Patel",
      "issue_date": ISODate("2026-03-01"),
      "due_date": ISODate("2026-03-15")
    }
  ]
}

-- Sample MongoDB Query:
-- db.books.find({ "inventory.available": { $gt: 0 }, "category.name": "Computer Science & Engineering" });
*/

-- Example 2: Firebase Realtime / Firestore Document Model:
/*
collection: 'books'
document: 'book_9780078022159'
fields: {
  title: "Database System Concepts",
  available_copies: 4,
  tags: ["DBMS", "SQL", "Relational Model"]
}
*/

-- 4.4 Cloud Database Architecture:
-- 1. DBaaS (Database as a Service): Managed MySQL on AWS RDS, Azure Database for MySQL, GCP Cloud SQL.
-- 2. Scaling:
--    - Vertical Scaling (Scale Up): Adding CPU/RAM to a single MySQL instance.
--    - Horizontal Scaling (Scale Out): Read Replicas for query offloading and Sharding for distributed partitioning.
-- 3. High Availability: Multi-AZ deployments with automatic failover and synchronous replication.

-- 4.5 Data Lake vs Data Warehouse Comparison:
-- +----------------------+-------------------------------+--------------------------------+
-- | Feature              | Data Warehouse (e.g. Redshift)| Data Lake (e.g. AWS S3, Delta) |
-- +----------------------+-------------------------------+--------------------------------+
-- | Schema Design        | Schema-on-Write (Structured)  | Schema-on-Read (Any format)    |
-- | Data Types           | Relational, cleansed, curated | Raw, structured, unstructured  |
-- | Processing Method    | ETL (Extract, Transform, Load)| ELT (Extract, Load, Transform) |
-- | Primary Users        | Business Analysts, SQL dev    | Data Scientists, ML Engineers  |
-- | Cost per Storage     | Higher cost per GB            | Very low cost object storage   |
-- +----------------------+-------------------------------+--------------------------------+

-- ==============================================================================
-- End of Comprehensive DBMS Syllabus Query Suite
-- ==============================================================================
