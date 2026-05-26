export function initDocumentationOverlay() {
    // Check if overlay already exists
    if (document.getElementById('doc-overlay')) return;

    // Create the overlay container
    const overlay = document.createElement('div');
    overlay.id = 'doc-overlay';
    overlay.className = 'doc-overlay';

    // Modal structure
    overlay.innerHTML = `
        <div class="doc-modal" id="doc-modal">
            <aside class="doc-sidebar" id="doc-sidebar">
                <div class="doc-sidebar-title">Documentation</div>
                <div class="doc-toc-container" id="doc-toc">
                    <!-- TOC injected here -->
                </div>
            </aside>
            <div class="doc-body">
                <header class="doc-header">
                    <button class="doc-close-btn" id="doc-close-btn" aria-label="Close documentation">&times;</button>
                </header>
                <div class="doc-scroll" id="doc-scroll">
                    <div class="doc-markdown" id="doc-markdown-content">
                        <div style="display:flex; justify-content:center; align-items:center; height:200px;">
                            <div class="doc-loading-spinner" style="border: 3px solid rgba(255,255,255,0.1); border-top: 3px solid #5d5dff; border-radius: 50%; width: 30px; height: 30px; animation: spin 1s linear infinite;"></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // Event listeners for closing
    const closeBtn = overlay.querySelector('#doc-close-btn');
    closeBtn.addEventListener('click', closeDocumentationOverlay);
    
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            closeDocumentationOverlay();
        }
    });

    // ESC key to close
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay.classList.contains('active')) {
            closeDocumentationOverlay();
        }
    });
}

export function openDocumentationOverlay() {
    initDocumentationOverlay();
    const overlay = document.getElementById('doc-overlay');
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden'; // Prevent background scrolling

    // Fetch and render the document if not loaded yet
    const contentContainer = document.getElementById('doc-markdown-content');
    if (contentContainer.getAttribute('data-loaded') !== 'true') {
        fetch('document.md')
            .then(res => {
                if (!res.ok) throw new Error('Failed to load documentation');
                return res.text();
            })
            .then(text => {
                renderDocumentation(text);
            })
            .catch(err => {
                contentContainer.innerHTML = `<div style="color: #ff5555; padding: 20px; text-align: center;">Error loading documentation: ${err.message}</div>`;
            });
    }
}

export function closeDocumentationOverlay() {
    const overlay = document.getElementById('doc-overlay');
    if (overlay) {
        overlay.classList.remove('active');
        document.body.style.overflow = '';
    }
}

function renderDocumentation(markdownText) {
    const contentContainer = document.getElementById('doc-markdown-content');
    const tocContainer = document.getElementById('doc-toc');

    // 1. Extract and escape code blocks to prevent parsing code contents as markdown
    const codeBlocks = [];
    let cleanText = markdownText.replace(/```(\w*)\n([\s\S]*?)\n```/g, (match, lang, code) => {
        const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
        codeBlocks.push({ lang, code });
        return `\n${placeholder}\n`;
    });

    // 2. Parse math equations (blocks and inline)
    // Double dollar blocks
    cleanText = cleanText.replace(/\$\$([\s\S]*?)\$\$/g, (match, math) => {
        return `<div class="doc-math-block">${math.trim()}</div>`;
    });
    // Single dollar inline
    cleanText = cleanText.replace(/\$([^$]+?)\$/g, (match, math) => {
        return `<code style="font-family: serif; font-style: italic; background: transparent; border: none; padding: 0; color: #a5a5ff;">${math.trim()}</code>`;
    });

    // 3. Process markdown line by line for structured headings and lists
    const lines = cleanText.split('\n');
    const htmlLines = [];
    const headers = [];
    let inList = false;
    let inNestedList = false;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];

        // Horizontal Rule
        if (line.trim() === '---') {
            if (inNestedList) { htmlLines.push('</ul>'); inNestedList = false; }
            if (inList) { htmlLines.push('</ul>'); inList = false; }
            htmlLines.push('<hr>');
            continue;
        }

        // Headings
        const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
        if (headingMatch) {
            if (inNestedList) { htmlLines.push('</ul>'); inNestedList = false; }
            if (inList) { htmlLines.push('</ul>'); inList = false; }

            const level = headingMatch[1].length;
            const text = headingMatch[2];
            // Format heading text inline styling
            const formattedText = parseInlineStyling(text);
            const cleanTextForId = text.replace(/`|\*\*|\*/g, '');
            const id = cleanTextForId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
            
            headers.push({ level, text: cleanTextForId, id });
            htmlLines.push(`<h${level} id="${id}">${formattedText}</h${level}>`);
            continue;
        }

        // Nested List Item (indented list)
        const nestedListMatch = line.match(/^(\s{2,})-\s+(.*)$/);
        if (nestedListMatch) {
            if (!inList) {
                htmlLines.push('<ul class="doc-list">');
                inList = true;
            }
            if (!inNestedList) {
                htmlLines.push('<ul class="doc-sublist">');
                inNestedList = true;
            }
            htmlLines.push(`<li>${parseInlineStyling(nestedListMatch[2])}</li>`);
            continue;
        }

        // Top-level List Item
        const listMatch = line.match(/^-\s+(.*)$/);
        if (listMatch) {
            if (inNestedList) {
                htmlLines.push('</ul>');
                inNestedList = false;
            }
            if (!inList) {
                htmlLines.push('<ul class="doc-list">');
                inList = true;
            }
            htmlLines.push(`<li>${parseInlineStyling(listMatch[1])}</li>`);
            continue;
        }

        // Empty Line
        if (line.trim() === '') {
            continue;
        }

        // Plain Paragraph
        if (inNestedList) { htmlLines.push('</ul>'); inNestedList = false; }
        if (inList) { htmlLines.push('</ul>'); inList = false; }

        if (line.startsWith('__CODE_BLOCK_') || line.startsWith('<div class="doc-math-block">')) {
            htmlLines.push(line);
        } else {
            htmlLines.push(`<p>${parseInlineStyling(line)}</p>`);
        }
    }

    if (inNestedList) htmlLines.push('</ul>');
    if (inList) htmlLines.push('</ul>');

    let fullHtml = htmlLines.join('\n');

    // 4. Substitute code blocks back with syntax highlighting
    fullHtml = fullHtml.replace(/__CODE_BLOCK_(\d+)__/g, (match, idx) => {
        const { lang, code } = codeBlocks[idx];
        const highlighted = highlightJS(code);
        return `<div class="doc-code-block"><pre><code>${highlighted}</code></pre></div>`;
    });

    // Inject into container
    contentContainer.innerHTML = fullHtml;
    contentContainer.setAttribute('data-loaded', 'true');

    // 5. Generate TOC sidebar
    generateTOC(headers, tocContainer);

    // 6. Set up smooth scroll event delegation and scroll spy
    setupScrollSpy();
}

function parseInlineStyling(text) {
    let html = text;
    // Bold
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Inline code
    html = html.replace(/`(.*?)`/g, '<code>$1</code>');
    // Links (standard markdown link)
    html = html.replace(/\[(.*?)\]\((.*?)\)/g, (match, label, href) => {
        if (href.startsWith('file://')) {
            return `<a href="${href}" target="_blank" class="doc-file-link">${label}</a>`;
        }
        return `<a href="${href}" target="_blank">${label}</a>`;
    });
    return html;
}

function highlightJS(code) {
    let html = code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // JS/GLSL Syntax Highlighting regex
    const tokenRegex = /(\/\/.*|\/\*[\s\S]*?\*\/)|('(?:\\['']|[^'\n])*'|"(?:\\[""]|[^"\n])*")|(\b(?:class|constructor|extends|super|return|import|export|from|const|let|var|function|new|if|else|for|while|int|float|vec3|vec4|uniform|varying|void|main|discard|break)\b)|(\b(?:THREE|Vector3|Color|Group|Scene|PerspectiveCamera|WebGLRenderer|OrbitControls|Clock|Float32Array|Math|StrokeDef|StrokeRenderer|StrokeAnimator)\b)|(\b\d+(?:\.\d+)?\b)|(\b\w+(?=\())/g;

    return html.replace(tokenRegex, (match, comment, string, keyword, builtin, number, func) => {
        if (comment) return `<span class="comment">${match}</span>`;
        if (string) return `<span class="string">${match}</span>`;
        if (keyword) return `<span class="keyword">${match}</span>`;
        if (builtin) return `<span class="class-name">${match}</span>`;
        if (number) return `<span class="number">${match}</span>`;
        if (func) return `<span class="function">${match}</span>`;
        return match;
    });
}

function generateTOC(headers, container) {
    let sidebarHtml = '<ul class="doc-toc-list">';
    let currentListOpen = false;

    headers.forEach(h => {
        // Skip h1 (main doc title) and h4/h5/h6
        if (h.level === 2) {
            if (currentListOpen) {
                sidebarHtml += '</ul></li>';
                currentListOpen = false;
            }
            sidebarHtml += `<li class="doc-toc-item"><a href="#${h.id}" class="doc-toc-link">${h.text}</a>`;
        } else if (h.level === 3) {
            if (!currentListOpen) {
                sidebarHtml += '<ul class="doc-toc-sublist">';
                currentListOpen = true;
            }
            sidebarHtml += `<li><a href="#${h.id}" class="doc-toc-sublink">${h.text}</a></li>`;
        }
    });

    if (currentListOpen) {
        sidebarHtml += '</ul></li>';
    }
    sidebarHtml += '</ul>';
    container.innerHTML = sidebarHtml;

    // Attach click events for smooth scrolling inside modal container
    const links = container.querySelectorAll('a');
    const docScroll = document.getElementById('doc-scroll');
    
    links.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const id = link.getAttribute('href').substring(1);
            const targetEl = document.getElementById(id);
            if (targetEl && docScroll) {
                // Remove active classes
                links.forEach(l => l.classList.remove('active'));
                link.classList.add('active');
                
                // Scroll container to element
                const offsetTop = targetEl.offsetTop - 10;
                docScroll.scrollTo({
                    top: offsetTop,
                    behavior: 'smooth'
                });
            }
        });
    });
}

function setupScrollSpy() {
    const docScroll = document.getElementById('doc-scroll');
    const tocLinks = document.querySelectorAll('.doc-toc-link, .doc-toc-sublink');
    const headings = document.querySelectorAll('.doc-markdown h2, .doc-markdown h3');

    if (!docScroll || headings.length === 0) return;

    docScroll.addEventListener('scroll', () => {
        let activeId = '';
        const scrollPos = docScroll.scrollTop + 30; // buffer offset

        for (let heading of headings) {
            if (heading.offsetTop <= scrollPos) {
                activeId = heading.id;
            } else {
                break;
            }
        }

        if (activeId) {
            tocLinks.forEach(link => {
                if (link.getAttribute('href') === `#${activeId}`) {
                    link.classList.add('active');
                } else {
                    link.classList.remove('active');
                }
            });
        }
    });
}
