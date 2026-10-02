/**
 * ?? Record Init-Scripts ? initScripts d?ng chung cho recorder (Lu?ng 1 & Lu?ng 2)
 *
 * T?ch t? scripts/record-ticket.js (pure refactor, kh?ng ??i h?nh vi) ?? c?
 * record-ticket.js (Manual Record) v? record-agent.js (Prompt-driven Auto-Record)
 * c?ng inject M?T b? init-script ?? ki?m ch?ng:
 *   - IFRAME_SCROLL_FIX_SCRIPT : m? kho? scroll cho iframe[title="Task frame"] (form d?i).
 *   - PF_DROPDOWN_BRIDGE_SCRIPT: gi? panel PrimeFaces s?ng ?? ghi tr?n click ch?n option.
 *   - DOM_ANNOTATOR_SCRIPT     : l?m s?ch class transient + g?n nh?n ?n ??nh cho locator.
 *
 * L?U ?: c?c init-script n?y CH? ???c n?p v?o context c?a recorder; KH?NG bao gi?
 * c? m?t trong playwright.config.ts hay test run ? n?n kh?ng ?nh h??ng h?i quy.
 */

'use strict';

const IFRAME_SCROLL_FIX_SCRIPT = `
(function () {
  'use strict';

  var isIframe = (window.self !== window.top);

  // Injects critical layout styles to allow full scrolling within the task document
  function injectScrollCss(doc) {
    if (!doc || !doc.documentElement) return;
    var styleId = '__asap_task_scroll_fix__';
    if (!doc.getElementById(styleId)) {
      var style = doc.createElement('style');
      style.id = styleId;
      style.textContent = [
        'html {',
        '  overflow-y: auto !important;',
        '  overflow-x: auto !important;',
        '  height: auto !important;',
        '  min-height: 100% !important;',
        '}',
        'body {',
        '  overflow: visible !important;',
        '  overflow-y: visible !important;',
        '  overflow-x: visible !important;',
        '  height: auto !important;',
        '  min-height: 100% !important;',
        '  position: relative !important;',
        '  padding-bottom: 80px !important;',
        '}',
        '.task-template-container,',
        '.task-template-content,',
        '.task-form-container,',
        '#task-template-container,',
        '#task-form,',
        'form {',
        '  overflow: visible !important;',
        '  height: auto !important;',
        '  max-height: none !important;',
        '}',
        '.task-template-footer,',
        '.ui-dialog-footer,',
        '.command-btns,',
        '.task-actions {',
        '  margin-top: 30px !important;',
        '  margin-bottom: 50px !important;',
        '  position: relative !important;',
        '  clear: both !important;',
        '  display: block !important;',
        '  z-index: 10 !important;',
        '}',
        'div:has(> button[id*="next"]),',
        'div:has(> button[id*="cancel"]),',
        'div:has(> button[id*="proceed"]) {',
        '  margin-top: 30px !important;',
        '  margin-bottom: 50px !important;',
        '  position: relative !important;',
        '  clear: both !important;',
        '}'
      ].join('\\n');
      (doc.head || doc.documentElement).appendChild(style);
    }
  }

  // Unlocks scrolling on containers inside the document
  function unlockDocumentScroll(doc) {
    if (!doc) return;
    if (doc.documentElement) {
      doc.documentElement.style.setProperty('overflow-y', 'auto', 'important');
    }
    if (doc.body) {
      doc.body.style.setProperty('overflow', 'visible', 'important');
      doc.body.style.setProperty('overflow-y', 'visible', 'important');
    }
    // Check internal containers that might trap scroll, excluding dropdown panels
    try {
      doc.querySelectorAll(
        '.task-template-container, .task-template-content, .task-form-container, ' +
        '.ui-widget-content:not(.ui-selectonemenu-panel):not(.ui-selectcheckboxmenu-panel):not(.ui-autocomplete-panel)'
      ).forEach(function (el) {
        if (el.scrollHeight > el.clientHeight + 10) {
          var cs = window.getComputedStyle(el);
          if (cs.overflow === 'hidden' || cs.overflowY === 'hidden') {
            el.style.setProperty('overflow-y', 'auto', 'important');
          }
        }
      });
    } catch (_) {}
  }

  // Target task iframes and direct wrappers on the parent (Portal Dashboard) page
  function fixTaskIframes(doc) {
    if (!doc) doc = document;
    var selectors = [
      'iframe[title="Task frame"]',
      'iframe[title*="Task"]',
      'iframe[class*="task-frame"]',
      'iframe[id*="taskFrame"]',
      'iframe[name*="taskFrame"]',
      'iframe#iFrame',
      'iframe[src*="TaskIframe"]',
      'iframe[src*="PortalTaskIframe"]'
    ];
    selectors.forEach(function (sel) {
      doc.querySelectorAll(sel).forEach(function (iframe) {
        if (iframe.getAttribute('scrolling') !== 'yes') {
          iframe.setAttribute('scrolling', 'yes');
        }
        iframe.style.setProperty('overflow', 'auto', 'important');
        iframe.style.setProperty('overflow-y', 'auto', 'important');
        iframe.style.setProperty('height', 'calc(100vh - 65px)', 'important');
        iframe.style.setProperty('min-height', '500px', 'important');
        iframe.style.setProperty('width', '100%', 'important');

        // Unlock direct parent wrapper without touching any global portal headers
        var parent = iframe.parentElement;
        if (parent && parent !== doc.body && parent !== doc.documentElement) {
          if (
            parent.classList.contains('task-frame-wrapper') ||
            parent.classList.contains('portal-task-container') ||
            parent.classList.contains('ivy-frame-wrapper') ||
            parent.id === 'task-frame-container'
          ) {
            parent.style.setProperty('height', 'calc(100vh - 65px)', 'important');
            parent.style.setProperty('overflow', 'visible', 'important');
          }
        }

        // Cross-frame fallback: try to inject into contentDocument directly from parent
        try {
          if (iframe.contentDocument) {
            injectScrollCss(iframe.contentDocument);
            unlockDocumentScroll(iframe.contentDocument);
          }
        } catch (_) {}
      });
    });
  }

  function runFix() {
    if (isIframe) {
      injectScrollCss(document);
      unlockDocumentScroll(document);
    } else {
      fixTaskIframes(document);
    }
  }

  if (document.readyState !== 'loading') {
    runFix();
  } else {
    document.addEventListener('DOMContentLoaded', runFix);
  }

  // Watch for PrimeFaces AJAX-driven DOM updates
  if (document.documentElement) {
    try {
      new MutationObserver(runFix).observe(
        document.documentElement,
        { childList: true, subtree: true }
      );
    } catch (_) {}
  }

  // Polling fallback to catch delayed AJAX completions
  setInterval(runFix, 600);
})();
`;

const PF_DROPDOWN_BRIDGE_SCRIPT = `
(function () {
  'use strict';

  var OPTION_SEL = 'li.ui-selectonemenu-item, .ui-selectonemenu-panel [role="option"], .ui-selectonemenu-items li, li.ui-selectcheckboxmenu-item, .ui-selectcheckboxmenu-panel li.ui-selectcheckboxmenu-item';
  var PANEL_SEL = '.ui-selectonemenu-panel, .ui-selectonemenu-items-wrapper, .ui-selectcheckboxmenu-panel, .ui-selectcheckboxmenu-items-wrapper';

  // Ensure every rendered option carries role="option" so Playwright codegen
  // generates a stable getByRole('option', { name }) locator for the click.
  // For selectCheckboxMenu items the accessible name lives in a child <label>
  // (no \`for\` attribute), so mirror it onto the <li> via aria-label to make the
  // name deterministic. Also promote the panel's Close button to a named button.
  function annotateOptions(root) {
    if (!root || !root.querySelectorAll) return;
    try {
      root.querySelectorAll(OPTION_SEL).forEach(function (li) {
        if (li.getAttribute('role') !== 'option') {
          li.setAttribute('role', 'option');
        }
        if (!li.getAttribute('aria-label')) {
          var lbl = li.querySelector('label');
          var txt = ((lbl ? lbl.textContent : li.textContent) || '').replace(/\\s+/g, ' ').trim();
          if (txt) li.setAttribute('aria-label', txt);
        }
      });
      root.querySelectorAll('.ui-selectcheckboxmenu-close').forEach(function (btn) {
        if (btn.getAttribute('role') !== 'button') btn.setAttribute('role', 'button');
        if (!btn.getAttribute('aria-label')) btn.setAttribute('aria-label', 'Close');
      });
    } catch (_) {}
  }

  function forceVisible(el) {
    if (!el) return;
    try {
      var cs = window.getComputedStyle(el);
      if (cs.display === 'none') el.style.setProperty('display', 'block', 'important');
      if (cs.visibility === 'hidden') el.style.setProperty('visibility', 'visible', 'important');
      if (cs.opacity === '0') el.style.setProperty('opacity', '1', 'important');
      if (el.hasAttribute('hidden')) el.removeAttribute('hidden');
      el.classList.remove('ui-helper-hidden', 'ui-helper-hidden-accessible');
    } catch (_) {}
  }

  // Keep the panel + option alive & visible until the trusted click lands, so
  // codegen reliably records the option-select gesture.
  function keepAlive(panel, li) {
    if (!panel || !li || li.__pfKeepAlive) return;
    li.__pfKeepAlive = true;

    var active = true;
    var parentNode = panel.parentNode;
    var nextSibling = panel.nextSibling;

    function pin() {
      if (!active) return;
      forceVisible(panel);
      forceVisible(li);
    }

    // Revert premature hide (display/class/hidden attribute flips).
    var attrMo = new MutationObserver(pin);
    try {
      attrMo.observe(panel, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    } catch (_) {}

    // Revert premature detach (some PF builds remove the panel from the DOM).
    var detachMo = new MutationObserver(function () {
      if (active && parentNode && !panel.isConnected) {
        try { parentNode.insertBefore(panel, nextSibling); } catch (_) {}
        pin();
      }
    });
    try {
      detachMo.observe(document.documentElement || document, { childList: true, subtree: true });
    } catch (_) {}

    pin();

    function release() {
      if (!active) return;
      active = false;
      try { attrMo.disconnect(); } catch (_) {}
      try { detachMo.disconnect(); } catch (_) {}
      document.removeEventListener('click', onClick, true);
      // Hand control back to PrimeFaces so the panel closes normally.
      setTimeout(function () {
        try {
          panel.style.removeProperty('display');
          panel.style.removeProperty('visibility');
          panel.style.removeProperty('opacity');
        } catch (_) {}
        li.__pfKeepAlive = false;
      }, 0);
    }

    function onClick(e) {
      if (e.target === li || (li.contains && li.contains(e.target))) {
        // The trusted click has now completed and been captured by codegen.
        setTimeout(release, 0);
      }
    }

    document.addEventListener('click', onClick, true);
    // Fallback release in case no click ever fires (defensive).
    setTimeout(release, 1200);
  }

  function optionFrom(target) {
    if (!target || !target.closest) return null;
    return target.closest(OPTION_SEL);
  }

  function onGestureStart(e) {
    var li = optionFrom(e.target);
    if (!li) return;
    var panel = li.closest(PANEL_SEL) || li.parentElement;
    if (panel) annotateOptions(panel);
    keepAlive(panel, li);
  }

  // Capture phase so we run before PrimeFaces' bubble-phase selection/hide.
  document.addEventListener('pointerdown', onGestureStart, true);
  document.addEventListener('mousedown', onGestureStart, true);

  // Eagerly annotate any panels that render (initial load + PrimeFaces AJAX).
  if (document.body) annotateOptions(document.body);
  try {
    new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        for (var j = 0; j < m.addedNodes.length; j++) {
          var node = m.addedNodes[j];
          if (node && node.nodeType === 1) annotateOptions(node);
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  } catch (_) {}

  setInterval(function () { annotateOptions(document); }, 700);
})();
`;

const DOM_ANNOTATOR_SCRIPT = "\n(function () {\n  'use strict';\n\n  // ─── Helper: remove transient PrimeFaces state classes ───\n  function cleanTransientClasses(root) {\n    var transient = ['ui-state-hover', 'ui-state-active', 'ui-state-focus', 'ui-state-highlight'];\n    transient.forEach(function(cls) {\n      root.querySelectorAll('.' + cls).forEach(function(el) {\n        el.classList.remove(cls);\n      });\n    });\n  }\n\n  // ─── Helper: annotate radio/checkbox with stable data-stable-label ───\n  function annotateRadios(root) {\n    // PrimeFaces radio: <div class=\"ui-radiobutton\"> <label for=\"...\"> ...Text... </label>\n    root.querySelectorAll('.ui-radiobutton, .ui-chkbox').forEach(function(wrapper) {\n      var input = wrapper.querySelector('input[type=\"radio\"], input[type=\"checkbox\"]');\n      if (!input || input.dataset.stableLabel) return;\n      // Try label[for=id]\n      var label = null;\n      if (input.id) {\n        label = document.querySelector('label[for=\"' + input.id + '\"]');\n      }\n      // Try sibling label inside same parent container\n      if (!label) {\n        var parent = wrapper.closest('.ui-selectoneradio-table, .ui-selectbooleancheckbox, [class*=\"field-container\"]');\n        if (parent) label = parent.querySelector('label');\n      }\n      if (label) {\n        var labelText = label.textContent.trim().replace(/\\s+/g, ' ');\n        input.dataset.stableLabel = labelText;\n        wrapper.dataset.stableLabel = labelText;\n      }\n    });\n  }\n\n  // ─── Helper: annotate dynamic task IDs with stable marker ───\n  function annotateDynamicIds(root) {\n    // e.g. href contains /faces/instances/CS-53605/ → mark the link\n    root.querySelectorAll('a[href*=\"/faces/instances/\"]').forEach(function(el) {\n      if (!el.dataset.stableMarker) el.dataset.stableMarker = 'task-link';\n    });\n  }\n\n  // ─── Helper: annotate selectonemenu dropdowns with stable data-stable-value ───\n  function annotateSelectMenus(root) {\n    root.querySelectorAll('.ui-selectonemenu').forEach(function(menu) {\n      var label = menu.querySelector('.ui-selectonemenu-label');\n      var hidden = menu.querySelector('select');\n      if (label && hidden && !menu.dataset.stableMenu) {\n        menu.dataset.stableMenu = hidden.id || hidden.name || 'select';\n        label.dataset.stableMenuLabel = 'true';\n      }\n    });\n  }\n\n  function annotateAll(root) {\n    cleanTransientClasses(root);\n    annotateRadios(root);\n    annotateDynamicIds(root);\n    annotateSelectMenus(root);\n  }\n\n  // Run on load\n  if (document.body) annotateAll(document.body);\n  window.addEventListener('DOMContentLoaded', function() { annotateAll(document.body); });\n\n  // Watch for AJAX mutations (PrimeFaces partial renders)\n  var observer = new MutationObserver(function(mutations) {\n    mutations.forEach(function(m) {\n      if (m.addedNodes.length > 0) {\n        m.addedNodes.forEach(function(node) {\n          if (node.nodeType === 1) annotateAll(node);\n        });\n      }\n      // Also clean transient classes added by PrimeFaces on hover\n      if (m.type === 'attributes' && m.attributeName === 'class') {\n        var el = m.target;\n        ['ui-state-hover','ui-state-active','ui-state-focus'].forEach(function(c) {\n          if (el.classList) el.classList.remove(c);\n        });\n      }\n    });\n  });\n\n  observer.observe(document.documentElement, {\n    childList: true,\n    subtree: true,\n    attributes: true,\n    attributeFilter: ['class']\n  });\n\n})();\n";

module.exports = {
  IFRAME_SCROLL_FIX_SCRIPT,
  PF_DROPDOWN_BRIDGE_SCRIPT,
  DOM_ANNOTATOR_SCRIPT,
};
