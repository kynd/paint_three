import { initDocumentationOverlay, openDocumentationOverlay } from './documentation.js';

document.addEventListener('DOMContentLoaded', () => {
    // Initialize overlay container
    initDocumentationOverlay();

    // Define navigation items
    const navItems = [
        { name: 'Stroke Gallery', url: 'index.html' },
        { name: 'Primitives', url: 'primitives.html' },
        { name: 'Mix', url: 'mix.html' },
        { name: 'Documentation', url: '#documentation' }
    ];

    // Determine current page for active link styling
    const path = window.location.pathname;
    let currentPage = path.split('/').pop();
    if (currentPage === '' || currentPage === '/') {
        currentPage = 'index.html';
    }

    // Create header element
    const header = document.createElement('header');
    header.className = 'main-header';

    // Create nav container
    const navContainer = document.createElement('nav');
    navContainer.className = 'nav-container';

    // Links container
    const linksList = document.createElement('ul');
    linksList.className = 'nav-links';

    // Populate links
    navItems.forEach(item => {
        const listItem = document.createElement('li');
        const link = document.createElement('a');
        link.href = item.url;
        link.className = 'nav-link';
        link.textContent = item.name;

        if (item.url === '#documentation') {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                openDocumentationOverlay();
            });
        } else {
            // Set active class if matching current page
            if (currentPage === item.url || (currentPage === 'index.html' && item.url === 'index.html')) {
                link.classList.add('active');
            }
        }

        listItem.appendChild(link);
        linksList.appendChild(listItem);
    });

    // Assemble navigation
    navContainer.appendChild(linksList);
    header.appendChild(navContainer);

    // Prepend to body
    document.body.insertBefore(header, document.body.firstChild);
});
