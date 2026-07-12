"use strict";
/**
 * Simple script to make text elements on the page editable,
 * and to save and restore the page across page loads.
 * 
 * Note: if running on the file:// protocol, some browsers may
 * disable access to localStorage.
 */
(function() {
    var VERSION = 1.2;

    var USE_CONTENTEDITABLE = !('designMode' in document);

    // Source https://stackoverflow.com/questions/494143/creating-a-new-dom-element-from-an-html-string-using-built-in-dom-methods-or-pro
    function htmlToElement(html) {
        var documentFragment = document.createDocumentFragment();
        var template = document.createElement('template');
        template.innerHTML = html.trim();
        for (var i = 0, e = template.content.childNodes.length; i < e; i++) {
            documentFragment.appendChild(template.content.childNodes[i].cloneNode(true));
        }
        return documentFragment;
    }

    function supportsLocalStorage() {
        if (!('localStorage' in window)) return false;
        try {
            localStorage.setItem('test', 'true');
            localStorage.getItem('test');
            localStorage.removeItem('test');
            return true;
        } catch (e) {
            return false;
        }
    }

    function supportsTemplate() {
        return ('content' in document.createElement('template'));
    }

    var hasLocalStorage = supportsLocalStorage();
    var hasTemplate = supportsTemplate();

    // True when served from the public deploy: render a read-only resume
    // (Save HTML + Print only, no edit/clear controls, no GitHub star,
    // no contentEditable). Local file:// keeps full authoring.
    var IS_DEPLOY = /(^|\.)sektant\.dev$/.test(location.hostname)
        || location.hostname.slice(-10) === '.github.io'
        || location.hostname === 'github.io';

    function savePage() {
        localStorage.setItem('page', escape(document.getElementById('save').innerHTML));
    }

    function getSavedPage() {
        var pageStr = localStorage.getItem('page');
        if (!(pageStr && pageStr.length)) return null;
        return unescape(pageStr);
    }

    function restoreSavedPage() {
        var savedPage = getSavedPage();
        if (savedPage) {
            document.getElementById('save').innerHTML = savedPage;
        }
    }

    function getDownloadLink(data, type) {
        var URL = (window.URL || window.webkitURL);
        var Blob = (window.Blob || window.MozBlob || window.WebKitBlob);
        var file = new Blob([String.fromCharCode(0xFEFF), data], { type: type }); // prepend BOM
        return URL.createObjectURL(file);
    }

    // Clone HTML node, but remove extraneous elements and make read-only
    // Clone <html>, strip editor-only elements and contenteditable, return node.
    function getCleanClone() {
        var baseEl = document.documentElement.cloneNode(true);
        baseEl.querySelector('body').removeAttribute('spellcheck');
        var elsToRemove = baseEl.querySelectorAll('script, iframe, #document-controls, #github-link');
        for (var i = 0, e = elsToRemove.length; i < e; i++) {
            elsToRemove[i].parentElement.removeChild(elsToRemove[i]);
        }

        if (USE_CONTENTEDITABLE) {
            var elsToReset = baseEl.querySelectorAll('[contenteditable]');
            for (var i = 0, e = elsToReset.length; i < e; i++) {
                elsToReset[i].removeAttribute('contenteditable');
                elsToReset[i].removeAttribute('spellcheck');
            }
        }

        return baseEl;
    }

    // Local asset = relative path (skip CDN/absolute/data URIs).
    function isLocalAsset(url) {
        return url && !/^(https?:)?\/\//.test(url) && url.slice(0, 5) !== 'data:';
    }

    function blobToDataURL(blob) {
        return new Promise(function(resolve, reject) {
            var reader = new FileReader();
            reader.onload = function() { resolve(reader.result); };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    // Replace local <link rel="stylesheet"> with inline <style>. CDN links kept.
    async function inlineStyles(root) {
        var links = root.querySelectorAll('link[rel="stylesheet"]');
        for (var i = 0; i < links.length; i++) {
            var link = links[i];
            var href = link.getAttribute('href');
            if (!isLocalAsset(href)) continue;
            try {
                var css = await (await fetch(href)).text();
                var style = document.createElement('style');
                var media = link.getAttribute('media');
                if (media) style.setAttribute('media', media);
                style.textContent = css;
                link.parentNode.replaceChild(style, link);
            } catch (e) { /* keep the link if fetch fails */ }
        }
    }

    // Embed local <img> sources as base64 data URIs so the file is portable.
    async function inlineImages(root) {
        var imgs = root.querySelectorAll('img');
        for (var i = 0; i < imgs.length; i++) {
            var img = imgs[i];
            var src = img.getAttribute('src');
            if (!isLocalAsset(src)) continue;
            try {
                var blob = await (await fetch(src)).blob();
                img.setAttribute('src', await blobToDataURL(blob));
            } catch (e) { /* keep the src if fetch fails */ }
        }
    }

    function addPage() {
        var sheetContainer = document.querySelector('.sheet').parentElement;
        var sheetHtml =
        `<section class="sheet">
            <aside></aside>
            <section></section>
        </section>`;
        sheetContainer.appendChild(htmlToElement(sheetHtml));
    }

    function getButtonActions() {
        return {
            'clear': function(e) {
                requestAnimationFrame(function() {
                    if (hasLocalStorage) {
                        localStorage.clear();
                        location.reload();
                    }
                });
            },
            'print': function(e) {
                requestAnimationFrame(function() {
                    window.print();
                });
            },
            'save': function(e) {
                saveToIndex();
            },
            'exportText': function(e) {
                var name = getFileBase();
                downloadFile(buildPlainText(), name + '.txt', 'text/plain; charset=UTF-8');
            },
            'exportJson': function(e) {
                var name = getFileBase();
                downloadFile(buildJsonResume(), name + '.json', 'application/json; charset=UTF-8');
            },
            'addPage': function(e) {
                addPage();
                updatePageNumbers();
            }
        };
    }

    function addDocumentControls() {
        if (!hasTemplate) return false;
        // Clear draft (edit) button, page navigation, and GitHub star are
        // authoring-only (local file:// / localhost), hidden on deploy.
        var isCover = /cover-letter\.html$/.test(location.pathname);
        var navHref = isCover ? 'index.html' : 'cover-letter.html';
        var navLabel = isCover ? 'Resume' : 'Cover Letter';
        var navBtn = IS_DEPLOY ? '' :
            `<a role="button" href="${navHref}" id="nav-link" title="Go to ${navLabel}">${navLabel}</a>`;
        var clearBtn = IS_DEPLOY ? '' :
            '<button data-action="clear" title="Remove saved draft">Clear draft</button>';
        var githubLink = IS_DEPLOY ? '' :
            `<div id="github-link">
                <a class="github-button" href="https://github.com/Tombarr/html-resume-template" data-size="large" data-show-count="true" aria-label="Star Tombarr/html-resume-template on GitHub">Star</a>
            </div>`;
        var docControlsStr =
            `<!-- Document control buttons-->
            <div id="document-controls">
                ${navBtn}
                ${clearBtn}
                <button data-action="save" title="Save changes into index.html">Save</button>
                <button data-action="print" title="Export as PDF">Export as PDF</button>
                <button data-action="exportText" title="Export as ATS-friendly plain text">Export as Text</button>
                <button data-action="exportJson" title="Export as JSON Resume">Export as JSON</button>
            </div>` + githubLink;
        var docControls = htmlToElement(docControlsStr);
        document.body.appendChild(docControls);
        return true;
    }

    function bindDocumentControls() {
        var actions = getButtonActions();
        var docControls = document.getElementById('document-controls');
        if (!docControls) return false;
        var buttons = docControls.querySelectorAll('button[data-action]');
        for (var i = 0, e = buttons.length; i < e; i++) {
            if (buttons[i].dataset.action in actions) {
                buttons[i].addEventListener('click', actions[buttons[i].dataset.action]);
            }
        }
        // designMode makes the whole document editable, which swallows link
        // clicks; navigate explicitly so the page-swap button works.
        var navLink = docControls.querySelector('#nav-link');
        if (navLink) {
            navLink.addEventListener('click', function(e) {
                e.preventDefault();
                window.location.href = navLink.getAttribute('href');
            });
        }
        return true;
    }

    function getFileBase() {
        return /cover-letter\.html$/.test(location.pathname) ? 'cover-letter' : 'resume';
    }

    // Trigger a browser download of arbitrary text data.
    function downloadFile(data, fileName, type) {
        var a = document.createElement('a');
        a.href = getDownloadLink(data, type);
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    // Serialize a self-contained HTML document: styles and images inlined so
    // the saved file renders standalone without the sibling asset files.
    async function buildFullDocument() {
        var baseEl = getCleanClone();
        await inlineStyles(baseEl);
        await inlineImages(baseEl);
        var attrs = '';
        for (var i = 0; i < baseEl.attributes.length; i++) {
            var a = baseEl.attributes[i];
            attrs += ' ' + a.name + (a.value ? '="' + a.value + '"' : '');
        }
        return '<!DOCTYPE html>\n<html' + attrs + '>\n' + baseEl.innerHTML + '\n</html>\n';
    }

    // Persisted file handle so repeated saves reuse the same target file.
    var indexFileHandle = null;

    // Save the current editor state back into index.html. Uses the File
    // System Access API when available (localhost/https) to write the file
    // in place; otherwise falls back to a download named index.html.
    async function saveToIndex() {
        var html = await buildFullDocument();
        var fileName = getFileBase() === 'cover-letter' ? 'cover-letter.html' : 'index.html';
        if (window.showSaveFilePicker) {
            try {
                if (!indexFileHandle) {
                    indexFileHandle = await window.showSaveFilePicker({
                        suggestedName: fileName,
                        types: [{ description: 'HTML', accept: { 'text/html': ['.html'] } }]
                    });
                }
                var writable = await indexFileHandle.createWritable();
                await writable.write(html);
                await writable.close();
            } catch (err) {
                if (err && err.name === 'AbortError') return; // user cancelled
                downloadFile(html, fileName, 'text/html; charset=UTF-8');
            }
        } else {
            downloadFile(html, fileName, 'text/html; charset=UTF-8');
        }
    }

    // --- Recruiting export helpers (plain text + JSON Resume) ---

    function textOf(el) {
        return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
    }

    function buildPlainText() {
        var L = [];
        var name = textOf(document.querySelector('.fullname'));
        var role = textOf(document.querySelector('.name h6'));
        if (name) L.push(name);
        if (role) L.push(role);
        L.push('');

        var contacts = document.querySelectorAll('.contact li');
        if (contacts.length) {
            L.push('CONTACT');
            for (var i = 0; i < contacts.length; i++) L.push(textOf(contacts[i]));
            L.push('');
        }

        var summary = textOf(document.querySelector('.summary p'));
        if (summary) { L.push('SUMMARY'); L.push(summary); L.push(''); }

        var skillSections = document.querySelectorAll('.skills');
        for (var s = 0; s < skillSections.length; s++) {
            var heading = textOf(skillSections[s].querySelector('h6')).toUpperCase();
            var items = skillSections[s].querySelectorAll('li');
            var vals = [];
            for (var k = 0; k < items.length; k++) vals.push(textOf(items[k]));
            if (heading && vals.length) { L.push(heading); L.push(vals.join(', ')); L.push(''); }
        }

        var expItems = document.querySelectorAll('.experience > ol > li');
        if (expItems.length) {
            L.push('EXPERIENCE');
            for (var e = 0; e < expItems.length; e++) {
                var item = expItems[e];
                var title = textOf(item.querySelector('.sanserif'));
                var time = textOf(item.querySelector('time'));
                var company = textOf(item.querySelector('header + span, .sanserif ~ span'));
                if (!company) {
                    var spans = item.querySelectorAll('span');
                    company = spans.length ? textOf(spans[0]) : '';
                }
                L.push(title + (time ? '  (' + time + ')' : ''));
                if (company) L.push(company);
                var bullets = item.querySelectorAll('ul li');
                for (var b = 0; b < bullets.length; b++) L.push('  - ' + textOf(bullets[b]));
                L.push('');
            }
        }

        var eduItems = document.querySelectorAll('.education > ol > li');
        if (eduItems.length) {
            L.push('EDUCATION');
            for (var d = 0; d < eduItems.length; d++) {
                var edu = eduItems[d];
                var degree = textOf(edu.querySelector('.sanserif'));
                var eduTime = textOf(edu.querySelector('time'));
                var school = textOf(edu.querySelector('span'));
                L.push(degree + (eduTime ? '  (' + eduTime + ')' : ''));
                if (school) L.push(school);
                L.push('');
            }
        }

        var langs = document.querySelectorAll('.references address');
        if (langs.length) {
            L.push('LANGUAGES');
            for (var g = 0; g < langs.length; g++) L.push(textOf(langs[g]));
            L.push('');
        }

        return L.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
    }

    // Emit a JSON Resume (jsonresume.org) style document for ATS/recruiter parsing.
    function buildJsonResume() {
        function attr(sel, name) {
            var el = document.querySelector(sel);
            return el ? (el.getAttribute(name) || '') : '';
        }
        var email = attr('.contact a[href^="mailto:"]', 'href').replace(/^mailto:/, '');
        var phone = attr('.contact a[href^="tel:"]', 'href').replace(/^tel:/, '');
        var site = attr('.contact a[href^="http"]', 'href');

        var profiles = [];
        var gh = document.querySelector('.contact a[href*="github.com"]');
        if (gh) profiles.push({ network: 'GitHub', url: gh.getAttribute('href') });

        var location = '';
        var locEl = document.querySelector('.contact li p');
        if (locEl && locEl.querySelector('.fa-map-marker-alt')) location = textOf(locEl);

        var basics = {
            name: textOf(document.querySelector('.fullname')),
            label: textOf(document.querySelector('.name h6')),
            email: email,
            phone: phone,
            url: site,
            summary: textOf(document.querySelector('.summary p')),
            location: { address: location },
            profiles: profiles
        };

        var work = [];
        var expItems = document.querySelectorAll('.experience > ol > li');
        for (var e = 0; e < expItems.length; e++) {
            var item = expItems[e];
            var spans = item.querySelectorAll('span');
            var highlights = [];
            var bullets = item.querySelectorAll('ul li');
            for (var b = 0; b < bullets.length; b++) highlights.push(textOf(bullets[b]));
            work.push({
                position: textOf(item.querySelector('.sanserif')),
                name: spans.length ? textOf(spans[0]) : '',
                period: textOf(item.querySelector('time')),
                highlights: highlights
            });
        }

        var education = [];
        var eduItems = document.querySelectorAll('.education > ol > li');
        for (var d = 0; d < eduItems.length; d++) {
            var edu = eduItems[d];
            education.push({
                studyType: textOf(edu.querySelector('.sanserif')),
                institution: textOf(edu.querySelector('span')),
                period: textOf(edu.querySelector('time'))
            });
        }

        var skills = [];
        var skillSections = document.querySelectorAll('.skills');
        for (var s = 0; s < skillSections.length; s++) {
            var kws = [];
            var items = skillSections[s].querySelectorAll('li');
            for (var k = 0; k < items.length; k++) kws.push(textOf(items[k]));
            skills.push({ name: textOf(skillSections[s].querySelector('h6')), keywords: kws });
        }

        var languages = [];
        var langs = document.querySelectorAll('.references address');
        for (var g = 0; g < langs.length; g++) {
            var parts = langs[g].innerHTML.split(/<br\s*\/?>/i);
            languages.push({
                language: (parts[0] || '').replace(/<[^>]*>/g, '').trim(),
                fluency: (parts[1] || '').replace(/<[^>]*>/g, '').trim()
            });
        }

        return JSON.stringify({
            $schema: 'https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json',
            basics: basics,
            work: work,
            education: education,
            skills: skills,
            languages: languages
        }, null, 2) + '\n';
    }

    function bindMutationObserver() {
        if (!('MutationObserver' in window) || !hasLocalStorage) return;

        function onMutate(mutations) {
            requestAnimationFrame(function() {
                savePage();
                updateMetadata();
            });
        }

        var observer = new MutationObserver(onMutate);

        var config = {
            childList: true,
            characterData: true,
            subtree: true
        };

        observer.observe(document.body, config);
    }

    function makeEditable() {
        if (USE_CONTENTEDITABLE) {
            var editableNodes = document.querySelectorAll('p, span, ul.editable, ol.editable, ul:not(.editable) li, ol:not(.editable) li, time, h1, h2, h3, h4, h5, h6, address');
            for (var i = 0, e = editableNodes.length; i < e; i++) {
                var node = editableNodes[i];
                node.setAttribute('contenteditable', 'true');
                node.setAttribute('spellcheck', 'true');
            }
        } else {
            document.body.setAttribute('spellcheck', 'true');
            document.designMode = 'on';
        }

        if (hasLocalStorage) {
            document.body.addEventListener('focusout', savePage);
            document.body.addEventListener('focusin', savePage);
        }
    }

    function updatePageNumbers() {
        var pages = document.querySelectorAll('.sheet');
        for (var i = 0, e = pages.length; i < e; i++) {
            pages[i].setAttribute('data-page-number', i + 1);
        }
        document.body.setAttribute('data-page-count', pages.length);
    }

    // Source https://stackoverflow.com/questions/12409299/how-to-get-current-formatted-date-dd-mm-yyyy-in-javascript-and-append-it-to-an-i
    function getDateFormatted(inDate) {
        var today = new Date();
        var date = (inDate) ? inDate : today;
        var dd = date.getDate();
        var mm = date.getMonth()+1;
        var yyyy = date.getFullYear();

        // Pad day and month if needed
        if (dd < 10) {
            dd = '0'+dd;
        }

        if (mm < 10) {
            mm = '0'+mm;
        }

        return yyyy+'-'+mm+'-'+dd;
    }

    // Metadata

    function updateMetadata() {
        updateMetaDate();
        updateMetaSubject();
        updateMetaAuthor();
        updateMetaKeywords();
        updateTitle();
    }

    function updateMetaDate() {
        document.querySelector('meta[name="date"]').setAttribute('content', getDateFormatted());
    }

    function getSummary() {
        var summaryEl = document.querySelector('.summary > p');
        if (!(summaryEl && summaryEl.textContent)) return '';
        var summaryText = summaryEl.textContent.trim().replace(/(\r\n\t|\n|\r\t)/gm, " ").replace(/\s+/g, " ");
        return summaryText;
    }

    function getAuthor() {
        var authorEl = document.querySelector('.name');
        if (!(authorEl && authorEl.textContent)) return '';
        var authorName = authorEl.getAttribute('aria-label').trim();
        return authorName;
    }

    function getSkills() {
        var skillEls = document.querySelectorAll('.skills li');
        if (!(skillEls && skillEls.length)) return [];
        var skills = new Array(skillEls.length);
        for (var i = 0, e = skillEls.length; i < e; i++) {
            skills[i] = skillEls[i].textContent.trim();
        }
        return skills;
    }

    function updateMetaSubject() {
        var summaryText = getSummary();
        if ((!summaryText && summaryText.length)) return;
        document.querySelector('meta[name="subject"]').setAttribute('content', summaryText);
    }

    function updateMetaAuthor() {
        var authorName = getAuthor();
        if (!(authorName && authorName.length)) return;
        document.querySelector('meta[name="author"]').setAttribute('content', authorName);
    }

    function updateMetaKeywords() {
        var skills = getSkills();
        if (!(skills && skills.length)) return;
        document.querySelector('meta[name="keywords"]').setAttribute('content', skills.join(','));
    }

    function updateTitle() {
        var authorName = getAuthor();
        var summaryText = getSummary();
        if ((!summaryText && summaryText.length) || !(authorName && authorName.length)) return;
        document.title = authorName + " - " + summaryText;
    }

    if (hasLocalStorage) {
        if (!IS_DEPLOY) restoreSavedPage();
        addDocumentControls();
        bindDocumentControls();
        if (!IS_DEPLOY) updateMetadata();
    }

    if (!IS_DEPLOY) {
        makeEditable();
        requestAnimationFrame(bindMutationObserver);
    }

    updatePageNumbers();
})();