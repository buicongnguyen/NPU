(() => {
  const managedTabIndex = 'data-scroll-tabindex-managed';
  const managedLabel = 'data-scroll-label-managed';
  const managedRole = 'data-scroll-role-managed';
  const scrollModes = new Set(['auto', 'scroll']);
  let scheduled = false;
  let scrollCandidateSelectors;

  const declaresScrollableOverflow = (style) =>
    ['overflow', 'overflowX', 'overflowY'].some((property) =>
      String(style?.[property] || '')
        .split(/\s+/)
        .some((value) => scrollModes.has(value))
    );

  const discoverScrollCandidateSelectors = () => {
    const selectors = new Set([
      '[style*="overflow" i]',
      `[${managedTabIndex}]`,
      `[${managedLabel}]`,
      `[${managedRole}]`
    ]);
    const visitRules = (rules) => {
      for (const rule of rules || []) {
        if (rule.selectorText && declaresScrollableOverflow(rule.style)) {
          selectors.add(rule.selectorText);
        }
        if (rule.cssRules) visitRules(rule.cssRules);
      }
    };

    for (const stylesheet of document.styleSheets) {
      try {
        visitRules(stylesheet.cssRules);
      } catch {
        // Cross-origin stylesheets cannot expose CSS rules; inline overflow remains discoverable.
      }
    }
    return [...selectors];
  };

  const scrollCandidates = () => {
    scrollCandidateSelectors ||= discoverScrollCandidateSelectors();
    const candidates = new Set();
    for (const selector of scrollCandidateSelectors) {
      try {
        for (const element of document.querySelectorAll(selector)) {
          if (element !== document.body && element !== document.documentElement) {
            candidates.add(element);
          }
        }
      } catch {
        // Selectors containing pseudo-elements cannot be queried as DOM elements.
      }
    }
    return [...candidates];
  };

  const isScrollable = (element) => {
    if (element.closest('[hidden], [aria-hidden="true"]')) return false;
    const closedDetails = element.closest('details:not([open])');
    const visibleSummary = closedDetails?.querySelector(':scope > summary');
    if (closedDetails && !visibleSummary?.contains(element)) return false;
    if (element.getClientRects().length === 0) return false;

    const style = getComputedStyle(element);
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;

    const horizontal =
      scrollModes.has(style.overflowX) && element.scrollWidth > element.clientWidth + 1;
    const vertical =
      scrollModes.has(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
    return horizontal || vertical;
  };

  const headingSelector = 'h1, h2, h3, h4, h5, h6';
  const readableText = (element) =>
    element?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 120) || '';
  const containerHeading = (element) => {
    const container = element.closest('section, article, main');
    return [...(container?.children ?? [])].find((child) => child.matches(headingSelector));
  };

  const nearestPrecedingHeading = (element) => {
    const boundary = element.closest('section, article, main');
    const broadHeading = containerHeading(element);
    let current = element;

    while (current && current !== boundary) {
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.matches(headingSelector) && sibling !== broadHeading) {
          return readableText(sibling);
        }
        const nestedHeadings = sibling.querySelectorAll(headingSelector);
        if (nestedHeadings.length > 0) {
          return readableText(nestedHeadings[nestedHeadings.length - 1]);
        }
        sibling = sibling.previousElementSibling;
      }
      current = current.parentElement;
    }

    return '';
  };

  const contentContext = (element) => {
    const detailsSummary = element.closest('details')?.querySelector(':scope > summary');
    if (detailsSummary) return readableText(detailsSummary);

    const caption = element.matches('table')
      ? element.querySelector(':scope > caption')
      : element.querySelector('table caption');
    if (caption) return readableText(caption);

    const figure = element.matches('figure') ? element : element.closest('figure');
    const figureCaption = figure?.querySelector(':scope > figcaption');
    if (figureCaption) return readableText(figureCaption);

    const codeHeader = element.closest('.code-panel')?.querySelector(':scope > header');
    if (codeHeader) return readableText(codeHeader);

    const localHeading = nearestPrecedingHeading(element);
    if (localHeading) return localHeading;

    if (element.id) return element.id.replace(/[-_]+/g, ' ');
    return readableText(containerHeading(element));
  };

  const contentKind = (element) => {
    if (element.matches('pre') || element.closest('.code-panel')) return 'code example';
    if (element.matches('table') || element.querySelector('table')) return 'data table';
    if (
      element.matches('figure') ||
      /diagram|figure|flow|lifecycle|pipeline|schedule|topology|trace-row/.test(
        element.className
      )
    ) {
      return 'diagram';
    }
    return 'content';
  };

  const accessibleLabel = (element) => {
    const context = contentContext(element);
    return `Scrollable ${contentKind(element)}${context ? `: ${context}` : ''}`;
  };

  const authoredAccessibleName = (element) => {
    if (!element.hasAttribute(managedLabel)) {
      const ariaLabel = element.getAttribute('aria-label')?.trim();
      if (ariaLabel) return ariaLabel;
    }

    const labelledBy = (element.getAttribute('aria-labelledby') || '')
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => readableText(document.getElementById(id)))
      .filter(Boolean)
      .join(' ');
    return labelledBy || element.getAttribute('title')?.trim() || '';
  };

  const refresh = () => {
    scheduled = false;
    const elements = scrollCandidates();
    const scrollableElements = new Set(elements.filter(isScrollable));
    const usedLabels = new Set(
      [...scrollableElements].map(authoredAccessibleName).filter(Boolean)
    );

    for (const element of elements) {
      if (scrollableElements.has(element)) {
        const isFocusableControl = element.matches(
          'a[href], button, input, select, textarea, summary, [contenteditable="true"]'
        );
        if (!element.hasAttribute('tabindex') && !isFocusableControl) {
          element.setAttribute('tabindex', '0');
          element.setAttribute(managedTabIndex, '');
        }
        const authoredName = authoredAccessibleName(element);
        if (authoredName && element.hasAttribute(managedLabel)) {
          element.removeAttribute('aria-label');
          element.removeAttribute(managedLabel);
        }
        if (!isFocusableControl && !authoredName) {
          const baseLabel = accessibleLabel(element);
          let uniqueLabel = baseLabel;
          let suffix = 2;
          while (usedLabels.has(uniqueLabel)) {
            uniqueLabel = `${baseLabel} (${suffix})`;
            suffix += 1;
          }
          usedLabels.add(uniqueLabel);
          element.setAttribute('aria-label', uniqueLabel);
          element.setAttribute(managedLabel, '');
        }
        if (!isFocusableControl && !element.hasAttribute('role') && element.matches('div, pre')) {
          element.setAttribute('role', 'group');
          element.setAttribute(managedRole, '');
        }
        continue;
      }

      if (element.hasAttribute(managedTabIndex)) {
        element.removeAttribute('tabindex');
        element.removeAttribute(managedTabIndex);
      }
      if (element.hasAttribute(managedLabel)) {
        element.removeAttribute('aria-label');
        element.removeAttribute(managedLabel);
      }
      if (element.hasAttribute(managedRole)) {
        element.removeAttribute('role');
        element.removeAttribute(managedRole);
      }
    }

    document.documentElement.dataset.scrollAccessibilityReady = 'true';
  };

  const scheduleRefresh = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(refresh);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleRefresh, { once: true });
  } else {
    scheduleRefresh();
  }

  window.addEventListener('load', scheduleRefresh, { once: true });
  window.addEventListener('resize', scheduleRefresh);
  document.fonts?.ready.then(scheduleRefresh);

  const mutationNeedsRefresh = (mutation) =>
    !(
      mutation.type === 'attributes' &&
      mutation.attributeName === 'style' &&
      mutation.target.closest('[data-scroll-accessibility-ignore-mutations]')
    );

  new MutationObserver((mutations) => {
    if (mutations.some(mutationNeedsRefresh)) scheduleRefresh();
  }).observe(document.documentElement, {
    attributeFilter: ['class', 'hidden', 'open', 'style'],
    attributes: true,
    childList: true,
    subtree: true
  });
})();
