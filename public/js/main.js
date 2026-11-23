/**
 * Library Management System - Frontend JavaScript
 * Simple, vanilla JavaScript for interactive controls and confirmation dialogs
 */

document.addEventListener('DOMContentLoaded', () => {
    // 1. Auto-dismiss alerts after 5 seconds
    const alerts = document.querySelectorAll('.alert-dismissible');
    alerts.forEach(alert => {
        setTimeout(() => {
            const bsAlert = bootstrap.Alert.getOrCreateInstance(alert);
            if (bsAlert) {
                bsAlert.close();
            }
        }, 5000);
    });

    // 2. Client-side table filter (Quick Search)
    const quickSearchInput = document.getElementById('tableQuickSearch');
    if (quickSearchInput) {
        quickSearchInput.addEventListener('input', function() {
            const filter = this.value.toLowerCase();
            const tableRows = document.querySelectorAll('.searchable-table tbody tr');

            tableRows.forEach(row => {
                const text = row.textContent.toLowerCase();
                if (text.includes(filter)) {
                    row.style.display = '';
                } else {
                    row.style.display = 'none';
                }
            });
        });
    }

    // 3. Confirm Delete Dialogs
    const deleteForms = document.querySelectorAll('.confirm-delete-form');
    deleteForms.forEach(form => {
        form.addEventListener('submit', function(e) {
            const itemType = this.getAttribute('data-item-type') || 'item';
            const confirmMsg = `Are you sure you want to delete this ${itemType}? This action cannot be undone.`;
            if (!confirm(confirmMsg)) {
                e.preventDefault();
            }
        });
    });

    // 4. Confirm Return Dialogs
    const returnForms = document.querySelectorAll('.confirm-return-form');
    returnForms.forEach(form => {
        form.addEventListener('submit', function(e) {
            if (!confirm('Confirm return of this book? If overdue, late fees will be assessed automatically.')) {
                e.preventDefault();
            }
        });
    });
});
