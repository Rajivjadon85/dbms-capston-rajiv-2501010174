/**
 * Authentication and Role-Based Access Control (RBAC) Middleware
 * Enforces session security for Admin and Student panels.
 */

// Check if user is logged in as an Admin
function isAdmin(req, res, next) {
    if (req.session && req.session.user && req.session.user.role === 'admin') {
        return next();
    }
    req.session.errorMessage = 'Access denied. Please log in as an Administrator.';
    return res.redirect('/auth/login?tab=admin');
}

// Check if user is logged in as a Student
function isStudent(req, res, next) {
    if (req.session && req.session.user && req.session.user.role === 'student') {
        return next();
    }
    req.session.errorMessage = 'Access denied. Please log in with your Student account.';
    return res.redirect('/auth/login?tab=student');
}

// Check if any authenticated user is logged in
function isLoggedIn(req, res, next) {
    if (req.session && req.session.user) {
        return next();
    }
    req.session.errorMessage = 'Please log in to continue.';
    return res.redirect('/auth/login');
}

// Redirect logged-in users away from login/register pages
function redirectIfLoggedIn(req, res, next) {
    if (req.session && req.session.user) {
        if (req.session.user.role === 'admin') {
            return res.redirect('/admin/dashboard');
        } else if (req.session.user.role === 'student') {
            return res.redirect('/student/dashboard');
        }
    }
    return next();
}

module.exports = {
    isAdmin,
    isStudent,
    isLoggedIn,
    redirectIfLoggedIn
};
