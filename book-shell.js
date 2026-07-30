(() => {
  "use strict";

  const root = document.documentElement;
  if (!document.head.querySelector('link[rel~="icon"]')) {
    const icon = document.createElement("link");
    icon.rel = "icon";
    icon.type = "image/svg+xml";
    icon.href = new URL(
      "avatar.svg",
      document.currentScript?.src || document.baseURI,
    ).href;
    document.head.append(icon);
  }
  const fallbackAttributeState = new Map();
  let shellEventController;

  function failOpen(error) {
    root.classList.remove("book-shell-booting");
    root.dataset.bookShellReady = "error";
    shellEventController?.abort();
    shellEventController = undefined;

    const body = document.body;
    if (body) {
      body.classList.remove(
        "book-shell-active",
        "book-sidebar-collapsed",
        "book-drawer-open",
        "book-family-practice",
        "book-family-npu-practice"
      );
      for (const heading of body.querySelectorAll("[data-book-shell-generated-id]")) {
        heading.removeAttribute("id");
        heading.removeAttribute("data-book-shell-generated-id");
      }
      for (const element of body.querySelectorAll("[data-book-shell-owned]")) {
        element.remove();
      }
    }

    for (const [element, ariaHidden] of fallbackAttributeState) {
      if (ariaHidden === null) element.removeAttribute("aria-hidden");
      else element.setAttribute("aria-hidden", ariaHidden);
    }
    fallbackAttributeState.clear();

    console.error("The study guide shell could not be initialized.", error);
  }

  root.classList.add("book-shell-booting");
  try {
  const themeKey = "site-color-theme";
  const legacyThemeKeys = ["npu-theme"];
  const bookmarksKey = "npu-study-guide-bookmarks-v1";
  const themeMedia = window.matchMedia("(prefers-color-scheme: dark)");
  let themeButton;
  let searchIndexPromise;

  function readStoredTheme() {
    try {
      const current = localStorage.getItem(themeKey);
      if (current === "light" || current === "dark") return current;

      for (const key of legacyThemeKeys) {
        const legacy = localStorage.getItem(key);
        if (legacy === "light" || legacy === "dark") {
          localStorage.setItem(themeKey, legacy);
          return legacy;
        }
      }
    } catch {
      // Storage can be unavailable in private or locked-down browsing contexts.
    }
    return null;
  }

  function resolvedTheme() {
    return readStoredTheme() || (themeMedia.matches ? "dark" : "light");
  }

  function updateThemeButton(theme) {
    if (!themeButton) return;
    const isDark = theme === "dark";
    const nextTheme = isDark ? "light" : "dark";
    themeButton.setAttribute("aria-label", `Switch to ${nextTheme} theme`);
    themeButton.removeAttribute("aria-pressed");
    themeButton.title = `Switch to ${nextTheme} theme`;
    const icon = themeButton.querySelector(".book-theme-icon");
    const label = themeButton.querySelector(".book-theme-label");
    if (icon) icon.textContent = isDark ? "☾" : "☀";
    if (label) label.textContent = isDark ? "Dark" : "Light";
  }

  function applyTheme(theme, persist = false) {
    const nextTheme = theme === "dark" ? "dark" : "light";
    root.dataset.bookTheme = nextTheme;
    root.dataset.siteTheme = nextTheme;
    root.dataset.theme = nextTheme;

    if (persist) {
      try {
        localStorage.setItem(themeKey, nextTheme);
      } catch {
        // The selected theme still applies for this page when storage is unavailable.
      }
    }

    updateThemeButton(nextTheme);
    document.dispatchEvent(
      new CustomEvent("bookthemechange", { detail: { theme: nextTheme } })
    );
  }

  applyTheme(resolvedTheme());

  const handleSystemThemeChange = () => {
    if (!readStoredTheme()) applyTheme(themeMedia.matches ? "dark" : "light");
  };
  if (typeof themeMedia.addEventListener === "function") {
    themeMedia.addEventListener("change", handleSystemThemeChange);
  } else if (typeof themeMedia.addListener === "function") {
    themeMedia.addListener(handleSystemThemeChange);
  }

  let chapterGroups = [];
  let chapters = [];

  async function loadBookManifest() {
    const response = await fetch("./data/book-manifest.json");
    if (!response.ok) {
      throw new Error(`Book manifest request failed with HTTP ${response.status}`);
    }
    const manifest = await response.json();
    if (
      manifest?.schemaVersion !== 1 ||
      !Array.isArray(manifest.groups) ||
      manifest.groups.length === 0
    ) {
      throw new Error("Book manifest has an unsupported shape");
    }

    const canonicalPaths = new Set();
    const seenRoutes = new Set();
    const seenGroupIds = new Set();
    const pathPattern = /^[a-z0-9-]+\.html$/;
    chapterGroups = manifest.groups.map((group) => {
      if (
        typeof group?.id !== "string" ||
        !/^[a-z0-9-]+$/.test(group.id) ||
        seenGroupIds.has(group.id) ||
        typeof group?.title !== "string" ||
        !Array.isArray(group.pages) ||
        group.pages.length === 0
      ) {
        throw new Error("Book manifest contains an invalid chapter group");
      }
      seenGroupIds.add(group.id);
      const pages = group.pages.map((page) => {
        const aliases = page?.aliases || [];
        if (
          typeof page?.path !== "string" ||
          !pathPattern.test(page.path) ||
          typeof page.title !== "string" ||
          seenRoutes.has(page.path) ||
          !Array.isArray(aliases) ||
          new Set(aliases).size !== aliases.length ||
          aliases.some(
            (alias) =>
              typeof alias !== "string" ||
              !pathPattern.test(alias) ||
              alias === page.path ||
              seenRoutes.has(alias)
          )
        ) {
          throw new Error("Book manifest contains an invalid or duplicate chapter");
        }
        canonicalPaths.add(page.path);
        seenRoutes.add(page.path);
        for (const alias of aliases) seenRoutes.add(alias);
        return { ...page };
      });
      return { ...group, pages };
    });
    chapters = chapterGroups.flatMap((group) =>
      group.pages.map((page) => ({
        ...page,
        groupId: group.id,
        groupTitle: group.title
      }))
    );
    for (const page of chapters) {
      for (const property of ["nextPath", "previousPath"]) {
        if (
          Object.hasOwn(page, property) &&
          page[property] !== null &&
          !canonicalPaths.has(page[property])
        ) {
          throw new Error(`Book manifest contains an unknown ${property}`);
        }
      }
    }
  }

  function currentFilename() {
    const pathname = decodeURIComponent(window.location.pathname);
    const finalSegment = pathname.split("/").filter(Boolean).pop();
    return (pathname.endsWith("/") || !finalSegment ? "index.html" : finalSegment).toLowerCase();
  }

  function pageMatches(page, filename) {
    if (page.path.toLowerCase() === filename) return true;
    return (page.aliases || []).some((alias) => alias.toLowerCase() === filename);
  }

  function makeElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function markOwned(element) {
    element.setAttribute("data-book-shell-owned", "");
    return element;
  }

  function headingSlug(value) {
    return value
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72);
  }

  function assignHeadingIds(main) {
    const usedIds = new Set(
      Array.from(main.querySelectorAll("[id]"), (element) => element.id)
    );
    for (const heading of main.querySelectorAll("h2, h3")) {
      if (heading.id) continue;
      const stem = `book-${headingSlug(heading.textContent.trim()) || "section"}`;
      let candidate = stem;
      let suffix = 2;
      while (usedIds.has(candidate)) {
        candidate = `${stem}-${suffix}`;
        suffix += 1;
      }
      heading.id = candidate;
      heading.setAttribute("data-book-shell-generated-id", "");
      usedIds.add(candidate);
    }
  }

  function revealTarget(target) {
    if (!target) return null;

    let closedDetails = target.closest("details:not([open])");
    while (closedDetails) {
      closedDetails.open = true;
      closedDetails = closedDetails.parentElement?.closest("details:not([open])") || null;
    }

    let hiddenPanel = target.closest('[role="tabpanel"][hidden]');
    while (hiddenPanel) {
      const tabset = hiddenPanel.closest("[data-tabset]");
      const tabs = tabset ? Array.from(tabset.querySelectorAll('[role="tab"]')) : [];
      const panels = tabset
        ? Array.from(tabset.querySelectorAll('[role="tabpanel"]'))
        : [];
      const controllingTab = tabs.find(
        (tab) => tab.getAttribute("aria-controls") === hiddenPanel.id
      );

      if (controllingTab) {
        for (const tab of tabs) {
          const selected = tab === controllingTab;
          tab.setAttribute("aria-selected", String(selected));
          tab.tabIndex = selected ? 0 : -1;
        }
        for (const panel of panels) {
          panel.hidden = panel !== hiddenPanel;
        }
      } else {
        hiddenPanel.hidden = false;
      }

      hiddenPanel = target.closest('[role="tabpanel"][hidden]');
    }

    return target;
  }

  function revealHashTarget() {
    if (window.location.hash.length < 2) return null;
    try {
      const requestedId = decodeURIComponent(window.location.hash.slice(1));
      return revealTarget(document.getElementById(requestedId));
    } catch {
      return null;
    }
  }

  function scrollToTarget(target, { focus = false } = {}) {
    const revealedTarget = revealTarget(target);
    if (!revealedTarget) return;
    window.requestAnimationFrame(() => {
      if (focus && revealedTarget instanceof HTMLElement) {
        if (!revealedTarget.hasAttribute("tabindex")) revealedTarget.tabIndex = -1;
        revealedTarget.focus({ preventScroll: true });
      }
      revealedTarget.scrollIntoView();
    });
  }

  function addHeadingAnchor(heading, targetId) {
    if (!heading || heading.querySelector(":scope > .book-heading-anchor")) return;
    if (!heading.hasAttribute("aria-label")) {
      heading.setAttribute("aria-label", heading.textContent.trim());
    }
    const anchor = markOwned(makeElement("a", "book-heading-anchor", "#"));
    anchor.href = `#${encodeURIComponent(targetId)}`;
    anchor.setAttribute("aria-label", `Link to ${heading.textContent.trim()}`);
    heading.append(" ", anchor);
  }

  function discoverSections(main) {
    const seen = new Set();
    return Array.from(main.querySelectorAll("h2, h3"))
      .filter((heading) => {
        if (heading.closest("details, dialog, [hidden], [aria-hidden='true']")) {
          return false;
        }
        if (
          heading.tagName === "H3" &&
          heading.closest(
            "[class*='-card'], [class*='-item'], .qa, .question, .quiz-question"
          )
        ) {
          return false;
        }
        return true;
      })
      .map((heading) => {
        const label = heading.textContent.trim();
        const structuralContainer = heading.closest("section[id], article[id]");
        const isPrimaryContainerHeading =
          heading.tagName === "H2" &&
          structuralContainer?.querySelector("h2, h3") === heading;
        const target = isPrimaryContainerHeading ? structuralContainer : heading;
        return {
          id: target.id,
          label,
          level: Number(heading.tagName.slice(1)),
          target,
          heading
        };
      })
      .filter((section) => {
        if (!section.id || seen.has(section.id)) return false;
        seen.add(section.id);
        addHeadingAnchor(section.heading, section.id);
        return true;
      });
  }

  function createPageOutline(main, sections) {
    if (sections.length < 2) return { outline: null, links: new Map() };

    const outline = markOwned(makeElement("details", "book-page-outline"));
    outline.id = "book-page-outline";
    if (
      window.location.hash.length > 1 ||
      window.matchMedia("(min-width: 1181px)").matches
    ) {
      outline.open = true;
    }

    const summary = makeElement("summary", "book-page-outline-summary");
    summary.append(makeElement("span", "", "On this page"));
    summary.append(
      makeElement(
        "span",
        "book-page-outline-count",
        `${sections.length} ${sections.length === 1 ? "section" : "sections"}`
      )
    );
    outline.append(summary);

    const navigation = makeElement("nav", "book-page-outline-nav");
    navigation.setAttribute("aria-label", "On this page");
    const list = makeElement("ol", "book-page-outline-list");
    const links = new Map();
    let currentPrimaryItem = null;
    let currentNestedList = null;

    for (const section of sections) {
      const item = makeElement(
        "li",
        `book-page-outline-item book-page-outline-level-${section.level}`
      );
      const anchor = makeElement("a", "book-page-outline-link", section.label);
      anchor.href = `#${encodeURIComponent(section.id)}`;
      item.append(anchor);

      if (section.level === 3 && currentPrimaryItem) {
        if (!currentNestedList) {
          currentNestedList = makeElement("ol", "book-page-outline-sublist");
          currentPrimaryItem.append(currentNestedList);
        }
        currentNestedList.append(item);
      } else {
        list.append(item);
        currentPrimaryItem = item;
        currentNestedList = null;
      }
      links.set(section.id, anchor);
    }

    navigation.append(list);
    outline.append(navigation);

    const hero = Array.from(main.children).find((child) =>
      child.matches(".hero, header.hero")
    );
    if (hero) hero.insertAdjacentElement("afterend", outline);
    else main.prepend(outline);

    return { outline, links };
  }

  function createPager(currentIndex) {
    const currentPage = chapters[currentIndex];
    const adjacentPage = (property, fallbackIndex) => {
      if (Object.hasOwn(currentPage, property)) {
        const targetPath = currentPage[property];
        return targetPath
          ? chapters.find((page) => page.path === targetPath) || null
          : null;
      }
      return chapters[fallbackIndex] || null;
    };
    const previous = adjacentPage("previousPath", currentIndex - 1);
    const next = adjacentPage("nextPath", currentIndex + 1);
    if (!previous && !next) return null;

    const pager = markOwned(makeElement("nav", "book-pager"));
    pager.setAttribute("aria-label", "Previous and next study chapters");

    function createPagerLink(page, direction) {
      if (!page) return makeElement("span", "book-pager-spacer");
      const anchor = makeElement("a", `book-pager-link book-pager-${direction}`);
      anchor.href = page.path;
      anchor.append(
        makeElement(
          "span",
          "book-pager-direction",
          direction === "previous" ? "← Previous chapter" : "Next chapter →"
        )
      );
      anchor.append(makeElement("strong", "", page.title));
      return anchor;
    }

    pager.append(createPagerLink(previous, "previous"));
    pager.append(createPagerLink(next, "next"));
    return pager;
  }

  function normalizeSearchText(value) {
    return value
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  async function loadSearchIndex() {
    if (!searchIndexPromise) {
      searchIndexPromise = fetch("./data/book-search-index.json")
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Search index request failed with HTTP ${response.status}`);
          }
          return response.json();
        })
        .then((index) => {
          if (
            index?.schemaVersion !== 1 ||
            index.chapterCount !== chapters.length ||
            !Array.isArray(index.entries)
          ) {
            throw new Error("Search index has an unsupported shape");
          }
          const canonicalPaths = new Set(chapters.map((page) => page.path));
          const isValid = index.entries.every(
            (entry) =>
              entry &&
              typeof entry.id === "string" &&
              typeof entry.path === "string" &&
              canonicalPaths.has(entry.path) &&
              typeof entry.anchor === "string" &&
              typeof entry.heading === "string" &&
              typeof entry.chapterTitle === "string" &&
              typeof entry.groupTitle === "string" &&
              Number.isInteger(entry.chapterIndex) &&
              entry.chapterIndex >= 1 &&
              entry.chapterIndex <= chapters.length &&
              Array.isArray(entry.keywords) &&
              typeof entry.text === "string"
          );
          if (!isValid) {
            throw new Error("Search index contains an invalid or non-canonical entry");
          }
          for (const entry of index.entries) {
            const heading = normalizeSearchText(entry.heading);
            const chapter = normalizeSearchText(entry.chapterTitle);
            const keywords = normalizeSearchText((entry.keywords || []).join(" "));
            const content = normalizeSearchText(entry.text || "");
            Object.defineProperty(entry, "normalizedSearch", {
              configurable: false,
              enumerable: false,
              writable: false,
              value: {
                heading,
                chapter,
                keywords,
                content,
                combined: `${heading} ${chapter} ${keywords} ${content}`
              }
            });
          }
          return index.entries;
        })
        .catch((error) => {
          searchIndexPromise = undefined;
          throw error;
        });
    }
    return searchIndexPromise;
  }

  function excerptForQuery(text, terms) {
    const source = String(text || "").replace(/\s+/g, " ").trim();
    if (!source) return "";
    const normalized = normalizeSearchText(source);
    const firstMatch = terms
      .map((term) => normalized.indexOf(term))
      .filter((index) => index >= 0)
      .sort((left, right) => left - right)[0];
    const start = Math.max(0, (firstMatch ?? 0) - 72);
    const end = Math.min(source.length, start + 230);
    return `${start > 0 ? "…" : ""}${source.slice(start, end).trim()}${
      end < source.length ? "…" : ""
    }`;
  }

  function createSearchDialog(searchButton) {
    const dialog = markOwned(makeElement("dialog", "book-search-dialog"));
    dialog.setAttribute("aria-labelledby", "book-search-title");

    const shell = makeElement("div", "book-search-shell");
    const header = makeElement("div", "book-search-header");
    const titleGroup = makeElement("div", "book-search-title-group");
    const title = makeElement("h2", "", "Search the study guide");
    title.id = "book-search-title";
    titleGroup.append(title);
    titleGroup.append(
      makeElement(
        "p",
        "",
        "Search all canonical chapters and jump directly to a topic."
      )
    );
    const closeForm = makeElement("form", "book-search-close-form");
    closeForm.method = "dialog";
    const closeButton = makeElement("button", "book-search-close", "×");
    closeButton.type = "submit";
    closeButton.setAttribute("aria-label", "Close study guide search");
    closeForm.append(closeButton);
    header.append(titleGroup, closeForm);

    const searchRegion = makeElement("div", "book-search-region");
    searchRegion.setAttribute("role", "search");
    const label = makeElement("label", "book-search-label", "Search topics");
    label.htmlFor = "book-search-input";
    const input = makeElement("input", "book-search-input");
    input.id = "book-search-input";
    input.type = "search";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.placeholder = "Try “Attention”, “MLIR”, “runtime”, or “SystemC”";
    const shortcut = makeElement("span", "book-search-shortcut", "Ctrl K");
    shortcut.setAttribute("aria-hidden", "true");
    const inputRow = makeElement("div", "book-search-input-row");
    inputRow.append(input, shortcut);
    searchRegion.append(label, inputRow);

    const status = makeElement(
      "p",
      "book-search-status",
      "Type at least two characters to search."
    );
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const results = makeElement("ol", "book-search-results");

    shell.append(header, searchRegion, status, results);
    dialog.append(shell);

    let entries = null;
    let searchUnavailable = false;
    let returnFocus = searchButton;

    const renderResults = () => {
      results.replaceChildren();
      const query = input.value.trim();
      const normalizedQuery = normalizeSearchText(query);
      if (normalizedQuery.length < 2) {
        status.textContent = "Type at least two characters to search.";
        return;
      }
      if (!entries) {
        status.textContent = searchUnavailable
          ? "Search is temporarily unavailable. Chapter navigation still works."
          : "Loading the search index…";
        return;
      }

      const terms = normalizedQuery.split(" ").filter(Boolean);
      const matches = entries
        .map((entry) => {
          const { heading, chapter, keywords, content, combined } =
            entry.normalizedSearch;
          const entrySpecific = `${heading} ${content}`;
          const searchable = entry.anchor ? entrySpecific : combined;
          if (!terms.every((term) => searchable.includes(term))) return null;

          let score = 0;
          if (heading === normalizedQuery) score += 120;
          if (heading.startsWith(normalizedQuery)) score += 70;
          if (heading.includes(normalizedQuery)) score += 45;
          if (chapter.includes(normalizedQuery)) score += 30;
          if (keywords.includes(normalizedQuery)) score += 22;
          score += terms.filter((term) => heading.includes(term)).length * 12;
          score += terms.filter((term) => content.includes(term)).length * 2;
          return { entry, score };
        })
        .filter(Boolean)
        .sort(
          (left, right) =>
            right.score - left.score ||
            left.entry.chapterIndex - right.entry.chapterIndex ||
            left.entry.id.localeCompare(right.entry.id)
        )
        .slice(0, 30);

      status.textContent =
        matches.length === 0
          ? `No topics found for “${query}”.`
          : `${matches.length} ${matches.length === 1 ? "result" : "results"} shown.`;

      for (const { entry } of matches) {
        const item = makeElement("li", "book-search-result");
        const anchor = makeElement("a", "book-search-result-link");
        anchor.href = `${entry.path}${
          entry.anchor ? `#${encodeURIComponent(entry.anchor)}` : ""
        }`;
        anchor.append(
          makeElement(
            "span",
            "book-search-result-meta",
            `Chapter ${entry.chapterIndex} · ${entry.groupTitle}`
          )
        );
        anchor.append(makeElement("strong", "", entry.heading));
        if (entry.heading !== entry.chapterTitle) {
          anchor.append(
            makeElement("span", "book-search-result-chapter", entry.chapterTitle)
          );
        }
        const excerpt = excerptForQuery(entry.text, terms);
        if (excerpt) {
          anchor.append(makeElement("span", "book-search-result-excerpt", excerpt));
        }
        item.append(anchor);
        results.append(item);
      }
    };

    const ensureIndex = async () => {
      if (entries) return;
      searchUnavailable = false;
      try {
        entries = await loadSearchIndex();
        renderResults();
      } catch (error) {
        searchUnavailable = true;
        renderResults();
        console.error("The study guide search index could not be loaded.", error);
      }
    };

    const openSearch = () => {
      if (document.body?.classList.contains("book-drawer-open")) return;
      returnFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : searchButton;
      if (!dialog.open) dialog.showModal();
      input.focus();
      input.select();
      void ensureIndex();
      renderResults();
    };

    searchButton.addEventListener("click", openSearch);
    input.addEventListener("input", renderResults);
    results.addEventListener("click", (event) => {
      const anchor = event.target.closest("a");
      if (
        !anchor ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return;
      }

      const destination = new URL(anchor.href, window.location.href);
      const isSameDocument =
        destination.origin === window.location.origin &&
        destination.pathname === window.location.pathname &&
        destination.search === window.location.search;
      returnFocus = null;
      dialog.close();
      if (!isSameDocument || !destination.hash) return;

      event.preventDefault();
      const targetId = decodeURIComponent(destination.hash.slice(1));
      const target = document.getElementById(targetId);
      if (window.location.hash !== destination.hash) {
        window.location.hash = destination.hash;
      }
      scrollToTarget(target, { focus: true });
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", () => {
      if (returnFocus?.isConnected) returnFocus.focus();
    });
    document.addEventListener(
      "keydown",
      (event) => {
        if (
          event.key.toLocaleLowerCase() === "k" &&
          (event.ctrlKey || event.metaKey) &&
          !event.altKey
        ) {
          event.preventDefault();
          openSearch();
        }
      },
      { signal: shellEventController.signal }
    );

    return dialog;
  }

  function readBookmarks() {
    try {
      const stored = JSON.parse(localStorage.getItem(bookmarksKey) || "[]");
      if (!Array.isArray(stored)) return new Set();
      const canonicalPaths = new Set(chapters.map((page) => page.path));
      return new Set(
        stored.filter((path) => typeof path === "string" && canonicalPaths.has(path))
      );
    } catch {
      return new Set();
    }
  }

  function writeBookmarks(bookmarks) {
    try {
      localStorage.setItem(bookmarksKey, JSON.stringify([...bookmarks].sort()));
    } catch {
      // Bookmarks remain available for this page when storage is unavailable.
    }
  }

  function createBookmarksExperience({
    currentPage,
    bookmarkButton,
    chapterLinks,
    panel,
    count,
    list,
    empty
  }) {
    let bookmarks = readBookmarks();
    const icon = bookmarkButton.querySelector(".book-bookmark-icon");
    const label = bookmarkButton.querySelector(".book-action-label");

    const render = () => {
      const currentIsBookmarked = bookmarks.has(currentPage.path);
      bookmarkButton.setAttribute("aria-pressed", String(currentIsBookmarked));
      bookmarkButton.setAttribute(
        "aria-label",
        currentIsBookmarked ? "Remove chapter bookmark" : "Bookmark this chapter"
      );
      bookmarkButton.title = currentIsBookmarked
        ? "Remove chapter bookmark"
        : "Bookmark this chapter";
      icon.textContent = currentIsBookmarked ? "★" : "☆";
      label.textContent = currentIsBookmarked ? "Saved" : "Bookmark";

      for (const [path, anchor] of chapterLinks) {
        anchor.classList.toggle("book-chapter-bookmarked", bookmarks.has(path));
      }

      list.replaceChildren();
      const savedPages = chapters.filter((page) => bookmarks.has(page.path));
      count.textContent = String(savedPages.length);
      empty.hidden = savedPages.length > 0;
      panel.classList.toggle("book-bookmarks-empty", savedPages.length === 0);
      for (const page of savedPages) {
        const item = makeElement("li", "book-bookmark-item");
        const anchor = makeElement("a", "book-bookmark-link", page.title);
        anchor.href = page.path;
        if (page.path === currentPage.path) {
          anchor.setAttribute("aria-current", "page");
        }
        item.append(anchor);
        list.append(item);
      }
    };

    bookmarkButton.addEventListener("click", () => {
      if (bookmarks.has(currentPage.path)) bookmarks.delete(currentPage.path);
      else bookmarks.add(currentPage.path);
      writeBookmarks(bookmarks);
      render();
    });
    window.addEventListener(
      "storage",
      (event) => {
        if (event.key !== bookmarksKey && event.key !== null) return;
        bookmarks = readBookmarks();
        render();
      },
      { signal: shellEventController.signal }
    );
    render();
  }

  async function initializeBookShell() {
    const body = document.body;
    const main = document.querySelector("main");
    if (!body || !main) {
      root.classList.remove("book-shell-booting");
      root.dataset.bookShellReady = "unsupported";
      return;
    }
    if (body.classList.contains("book-shell-active")) {
      root.classList.remove("book-shell-booting");
      return;
    }

    await loadBookManifest();

    const filename = currentFilename();
    const currentIndex = chapters.findIndex((page) => pageMatches(page, filename));
    if (currentIndex < 0) {
      root.classList.remove("book-shell-booting");
      root.dataset.bookShellReady = "unsupported";
      return;
    }
    shellEventController = new AbortController();

    const currentPage = chapters[currentIndex];
    if (/^(?:c|deep-learning|embedded|git|interview|os)-practice\.html$/.test(filename)) {
      body.classList.add("book-family-practice");
    }
    if (filename === "npu-practice.html") body.classList.add("book-family-npu-practice");

    if (!main.id) main.id = "book-main";
    if (!main.hasAttribute("tabindex")) main.tabIndex = -1;

    const skipLink = markOwned(
      makeElement("a", "book-skip-link", "Skip to study content")
    );
    skipLink.href = `#${encodeURIComponent(main.id)}`;
    skipLink.addEventListener("click", () => {
      window.setTimeout(() => main.focus({ preventScroll: true }), 0);
    });

    const topbar = markOwned(makeElement("div", "book-topbar"));
    const menuButton = makeElement("button", "book-menu-toggle", "☰");
    menuButton.type = "button";
    menuButton.setAttribute("aria-label", "Toggle study chapters");
    menuButton.setAttribute("aria-controls", "book-sidebar");
    menuButton.setAttribute("aria-expanded", "true");

    const homeLink = makeElement("a", "book-home-link");
    homeLink.href = "index.html";
    homeLink.setAttribute("aria-label", "NPU Engineering Study Guide home");
    homeLink.append(makeElement("span", "book-home-mark", "NPU"));
    homeLink.append(makeElement("strong", "book-home-title", "Engineering Study Guide"));

    const position = makeElement("div", "book-chapter-position");
    position.setAttribute("aria-label", `Chapter ${currentIndex + 1} of ${chapters.length}`);
    position.append(makeElement("span", "book-chapter-group", currentPage.groupTitle));
    position.append(
      makeElement(
        "strong",
        "book-chapter-index",
        `Chapter ${currentIndex + 1} / ${chapters.length}`
      )
    );

    const actions = makeElement("nav", "book-topbar-actions");
    actions.setAttribute("aria-label", "Study guide controls");
    const searchButton = makeElement("button", "book-search-toggle");
    searchButton.type = "button";
    searchButton.setAttribute("aria-label", "Search the study guide");
    searchButton.setAttribute("aria-keyshortcuts", "Control+K Meta+K");
    const searchIcon = makeElement("span", "book-action-icon", "⌕");
    searchIcon.setAttribute("aria-hidden", "true");
    searchButton.append(searchIcon);
    searchButton.append(makeElement("span", "book-action-label", "Search"));

    const bookmarkButton = makeElement("button", "book-bookmark-toggle");
    bookmarkButton.type = "button";
    bookmarkButton.setAttribute("aria-pressed", "false");
    const bookmarkIcon = makeElement("span", "book-bookmark-icon", "☆");
    bookmarkIcon.setAttribute("aria-hidden", "true");
    bookmarkButton.append(bookmarkIcon);
    bookmarkButton.append(makeElement("span", "book-action-label", "Bookmark"));

    const sourceLink = makeElement("a", "book-source-link", "GitHub");
    sourceLink.href = "https://github.com/buicongnguyen/NPU";
    sourceLink.setAttribute("aria-label", "Open the NPU Study Guide source on GitHub");

    themeButton = makeElement("button", "book-theme-toggle");
    themeButton.type = "button";
    themeButton.append(makeElement("span", "book-theme-icon"));
    themeButton.querySelector(".book-theme-icon").setAttribute("aria-hidden", "true");
    themeButton.append(makeElement("span", "book-theme-label"));
    themeButton.addEventListener("click", () => {
      const nextTheme = root.dataset.bookTheme === "dark" ? "light" : "dark";
      applyTheme(nextTheme, true);
    });
    updateThemeButton(root.dataset.bookTheme);

    actions.append(searchButton, bookmarkButton, sourceLink, themeButton);
    topbar.append(menuButton);
    topbar.append(homeLink);
    topbar.append(position);
    topbar.append(actions);

    const readingProgress = makeElement("div", "book-reading-progress");
    readingProgress.setAttribute("role", "progressbar");
    readingProgress.setAttribute("aria-label", "Page reading progress");
    readingProgress.setAttribute("aria-valuemin", "0");
    readingProgress.setAttribute("aria-valuemax", "100");
    readingProgress.setAttribute("aria-valuenow", "0");
    const readingProgressValue = makeElement(
      "span",
      "book-reading-progress-value"
    );
    readingProgressValue.setAttribute(
      "data-scroll-accessibility-ignore-mutations",
      ""
    );
    readingProgress.append(readingProgressValue);
    topbar.append(readingProgress);

    const sidebar = markOwned(makeElement("aside", "book-sidebar"));
    sidebar.id = "book-sidebar";
    sidebar.setAttribute("aria-label", "NPU Study Guide chapters");
    sidebar.tabIndex = -1;

    const sidebarHeader = makeElement("div", "book-sidebar-header");
    sidebarHeader.append(makeElement("strong", "", "Study chapters"));
    sidebarHeader.append(
      makeElement(
        "span",
        "",
        `${chapters.length} chapters · foundations to specialization`
      )
    );
    const sidebarClose = makeElement("button", "book-sidebar-close", "×");
    sidebarClose.type = "button";
    sidebarClose.setAttribute("aria-label", "Close study chapters");
    sidebarHeader.append(sidebarClose);
    sidebar.append(sidebarHeader);

    const bookmarksPanel = makeElement("section", "book-bookmarks-panel");
    bookmarksPanel.setAttribute("aria-labelledby", "book-bookmarks-title");
    const bookmarksHeading = makeElement("h2", "book-bookmarks-title");
    bookmarksHeading.id = "book-bookmarks-title";
    bookmarksHeading.append("Bookmarks ");
    const bookmarksCount = makeElement("span", "book-bookmarks-count", "0");
    bookmarksHeading.append(bookmarksCount);
    const bookmarksEmpty = makeElement(
      "p",
      "book-bookmarks-empty-message",
      "Save a chapter to pin it here."
    );
    const bookmarksList = makeElement("ol", "book-bookmarks-list");
    bookmarksPanel.append(bookmarksHeading, bookmarksEmpty, bookmarksList);
    sidebar.append(bookmarksPanel);

    const chapterNavigation = makeElement("nav", "book-chapter-nav");
    chapterNavigation.setAttribute("aria-label", "Study chapters");
    const chapterLinks = new Map();
    let currentChapterLink;
    let chapterNumber = 0;

    for (const group of chapterGroups) {
      const groupContainer = makeElement("div", "book-nav-group");
      groupContainer.append(makeElement("p", "book-nav-group-title", group.title));
      const list = makeElement("ol", "book-nav-list");

      for (const page of group.pages) {
        chapterNumber += 1;
        const item = makeElement("li", "book-nav-item");
        const anchor = makeElement("a", "book-chapter-link");
        anchor.href = page.path;
        anchor.append(
          makeElement("span", "book-chapter-number", String(chapterNumber).padStart(2, "0"))
        );
        anchor.append(makeElement("span", "book-chapter-title", page.title));
        const marker = makeElement("span", "book-chapter-bookmark-marker", "★");
        marker.setAttribute("aria-hidden", "true");
        anchor.append(marker);
        chapterLinks.set(page.path, anchor);
        if (pageMatches(page, filename)) {
          anchor.setAttribute("aria-current", "page");
          currentChapterLink = anchor;
        }
        item.append(anchor);
        list.append(item);
      }

      groupContainer.append(list);
      chapterNavigation.append(groupContainer);
    }

    sidebar.append(chapterNavigation);
    const sidebarFooter = makeElement("div", "book-sidebar-footer");
    sidebarFooter.append(makeElement("span", "", "NPU Engineering Study Guide"));
    const repositoryLink = makeElement("a", "", "Source and contributions");
    repositoryLink.href = "https://github.com/buicongnguyen/NPU";
    sidebarFooter.append(repositoryLink);
    sidebar.append(sidebarFooter);

    const searchDialog = createSearchDialog(searchButton);
    createBookmarksExperience({
      currentPage,
      bookmarkButton,
      chapterLinks,
      panel: bookmarksPanel,
      count: bookmarksCount,
      list: bookmarksList,
      empty: bookmarksEmpty
    });

    const backdrop = markOwned(makeElement("div", "book-drawer-backdrop"));
    backdrop.setAttribute("aria-hidden", "true");

    body.append(searchDialog);
    body.prepend(backdrop);
    body.prepend(sidebar);
    body.prepend(topbar);
    body.prepend(skipLink);
    body.classList.add("book-shell-active");
    root.classList.remove("book-shell-booting");

    assignHeadingIds(main);
    const requestedTarget = revealHashTarget();
    if (requestedTarget) {
      scrollToTarget(requestedTarget);
    }
    const sections = discoverSections(main);
    const { outline, links: outlineLinks } = createPageOutline(main, sections);
    const pager = createPager(currentIndex);
    if (pager) main.insertAdjacentElement("afterend", pager);

    const printMedia = window.matchMedia("print");
    const printDetailsState = new Map();
    function enterPrintMode() {
      if (printDetailsState.size > 0) return;
      for (const details of main.querySelectorAll("details:not(.book-page-outline)")) {
        printDetailsState.set(details, details.open);
        details.open = true;
      }
    }

    function exitPrintMode() {
      for (const [details, wasOpen] of printDetailsState) details.open = wasOpen;
      printDetailsState.clear();
    }

    window.addEventListener("beforeprint", enterPrintMode);
    window.addEventListener("afterprint", exitPrintMode);
    const handlePrintMedia = (event) => {
      if (event.matches) enterPrintMode();
      else exitPrintMode();
    };
    if (typeof printMedia.addEventListener === "function") {
      printMedia.addEventListener("change", handlePrintMedia);
    } else if (typeof printMedia.addListener === "function") {
      printMedia.addListener(handlePrintMedia);
    }
    if (printMedia.matches) enterPrintMode();

    const originalToc = document.querySelector("nav.toc");
    if (originalToc) {
      fallbackAttributeState.set(originalToc, originalToc.getAttribute("aria-hidden"));
      originalToc.setAttribute("aria-hidden", "true");
    }

    let activeSectionId = "";
    function setActiveSection(id) {
      if (!outlineLinks.has(id) || id === activeSectionId) return;
      activeSectionId = id;
      for (const [sectionId, link] of outlineLinks) {
        if (sectionId === id) link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
      }
    }

    let scrollFrame = 0;
    let lastReadingPercent = -1;
    function updateScrollState() {
      scrollFrame = 0;
      const activationLine =
        Number.parseFloat(
          getComputedStyle(root).getPropertyValue("--book-bar-height")
        ) || 64;
      let active = sections[0];
      for (const section of sections) {
        if (section.target.getBoundingClientRect().top <= activationLine + 36) {
          active = section;
        } else {
          break;
        }
      }
      const maxScroll = Math.max(
        0,
        document.documentElement.scrollHeight - window.innerHeight
      );
      if (sections.length > 0 && window.scrollY >= maxScroll - 2) {
        active = sections[sections.length - 1];
      }
      const readingPercent =
        maxScroll === 0 ? 100 : Math.round((window.scrollY / maxScroll) * 100);
      const boundedPercent = Math.max(0, Math.min(100, readingPercent));
      readingProgressValue.style.transform = `scaleX(${boundedPercent / 100})`;
      if (boundedPercent !== lastReadingPercent) {
        readingProgress.setAttribute("aria-valuenow", String(boundedPercent));
        lastReadingPercent = boundedPercent;
      }
      if (active) setActiveSection(active.id);
    }

    function scheduleScrollUpdate() {
      if (!scrollFrame) scrollFrame = window.requestAnimationFrame(updateScrollState);
    }

    window.addEventListener("scroll", scheduleScrollUpdate, { passive: true });
    window.addEventListener("resize", scheduleScrollUpdate);
    if (typeof ResizeObserver === "function") {
      const readingLayoutObserver = new ResizeObserver(scheduleScrollUpdate);
      readingLayoutObserver.observe(main);
    }
    window.addEventListener("hashchange", () => {
      const requestedTarget = revealHashTarget();
      const id = requestedTarget?.id || "";
      if (requestedTarget) {
        scrollToTarget(requestedTarget);
      }
      if (outlineLinks.has(id)) {
        if (outline) outline.open = true;
        setActiveSection(id);
      }
    });
    scheduleScrollUpdate();

    const mobileSidebar = window.matchMedia("(max-width: 1180px)");
    let drawerOpen = false;
    let desktopCollapsed = false;
    const backgroundInertState = new Map();

    function setBackgroundInert(inert) {
      const shellElements = new Set([skipLink, topbar, sidebar, backdrop]);
      if (inert) {
        for (const child of Array.from(body.children)) {
          if (shellElements.has(child) || child.tagName === "SCRIPT") continue;
          backgroundInertState.set(child, child.inert);
          child.inert = true;
        }
        return;
      }

      for (const [element, wasInert] of backgroundInertState) {
        element.inert = wasInert;
      }
      backgroundInertState.clear();
    }

    function syncSidebarState({ restoreFocus = false } = {}) {
      const isMobile = mobileSidebar.matches;
      if (isMobile) {
        body.classList.remove("book-sidebar-collapsed");
        body.classList.toggle("book-drawer-open", drawerOpen);
        menuButton.setAttribute("aria-expanded", String(drawerOpen));
        sidebar.toggleAttribute("inert", !drawerOpen);
        sidebar.setAttribute("aria-hidden", String(!drawerOpen));
        backdrop.setAttribute("aria-hidden", String(!drawerOpen));
        topbar.inert = drawerOpen;
        skipLink.inert = drawerOpen;
        setBackgroundInert(drawerOpen);

        if (drawerOpen) {
          sidebar.setAttribute("role", "dialog");
          sidebar.setAttribute("aria-modal", "true");
          window.requestAnimationFrame(() => {
            (currentChapterLink || sidebar).focus();
          });
        } else {
          sidebar.removeAttribute("role");
          sidebar.removeAttribute("aria-modal");
          if (restoreFocus) menuButton.focus();
        }
        return;
      }

      drawerOpen = false;
      body.classList.remove("book-drawer-open");
      body.classList.toggle("book-sidebar-collapsed", desktopCollapsed);
      menuButton.setAttribute("aria-expanded", String(!desktopCollapsed));
      sidebar.toggleAttribute("inert", desktopCollapsed);
      if (desktopCollapsed) sidebar.setAttribute("aria-hidden", "true");
      else sidebar.removeAttribute("aria-hidden");
      sidebar.removeAttribute("role");
      sidebar.removeAttribute("aria-modal");
      backdrop.setAttribute("aria-hidden", "true");
      topbar.inert = false;
      skipLink.inert = false;
      setBackgroundInert(false);
      if (desktopCollapsed && restoreFocus) menuButton.focus();
    }

    function closeDrawer(restoreFocus = false) {
      if (!drawerOpen) return;
      drawerOpen = false;
      syncSidebarState({ restoreFocus });
    }

    menuButton.addEventListener("click", () => {
      if (mobileSidebar.matches) {
        drawerOpen = !drawerOpen;
        syncSidebarState({ restoreFocus: !drawerOpen });
      } else {
        desktopCollapsed = !desktopCollapsed;
        syncSidebarState({ restoreFocus: desktopCollapsed });
      }
    });

    backdrop.addEventListener("click", () => closeDrawer(true));
    sidebarClose.addEventListener("click", () => closeDrawer(true));
    sidebar.addEventListener("click", (event) => {
      const anchor = event.target.closest("a");
      if (!mobileSidebar.matches || !anchor) return;
      const keepsCurrentPage =
        event.defaultPrevented ||
        event.button !== 0 ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        (anchor.target && anchor.target.toLowerCase() !== "_self") ||
        anchor.hasAttribute("download");
      closeDrawer(keepsCurrentPage);
    });

    document.addEventListener("keydown", (event) => {
      if (!mobileSidebar.matches || !drawerOpen) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeDrawer(true);
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        sidebar.querySelectorAll(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => !element.hidden && element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        sidebar.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !sidebar.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !sidebar.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    });

    const handleSidebarBreakpoint = () => {
      const focusWillBeHidden = sidebar.contains(document.activeElement);
      syncSidebarState({ restoreFocus: focusWillBeHidden });
      scheduleScrollUpdate();
    };
    if (typeof mobileSidebar.addEventListener === "function") {
      mobileSidebar.addEventListener("change", handleSidebarBreakpoint);
    } else if (typeof mobileSidebar.addListener === "function") {
      mobileSidebar.addListener(handleSidebarBreakpoint);
    }
    syncSidebarState();

    window.requestAnimationFrame(() => {
      if (currentChapterLink) {
        const linkBounds = currentChapterLink.getBoundingClientRect();
        const navigationBounds = chapterNavigation.getBoundingClientRect();
        const targetTop =
          chapterNavigation.scrollTop +
          linkBounds.top -
          navigationBounds.top -
          navigationBounds.height / 2 +
          linkBounds.height / 2;
        chapterNavigation.scrollTop = Math.max(0, targetTop);
      }
      scheduleScrollUpdate();
      root.dataset.bookShellReady = "true";
      document.dispatchEvent(new CustomEvent("bookshellready"));
    });
  }

  async function startBookShell() {
    try {
      await initializeBookShell();
    } catch (error) {
      failOpen(error);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startBookShell, { once: true });
  } else {
    startBookShell();
  }
  } catch (error) {
    failOpen(error);
  }
})();
