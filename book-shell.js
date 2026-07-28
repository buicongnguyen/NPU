(() => {
  "use strict";

  const root = document.documentElement;
  const themeKey = "site-color-theme";
  const legacyThemeKeys = ["npu-theme"];
  const themeMedia = window.matchMedia("(prefers-color-scheme: dark)");
  let themeButton;

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
    root.style.colorScheme = nextTheme;

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

  const chapterGroups = [
    {
      title: "Start here",
      pages: [
        {
          path: "index.html",
          aliases: ["npu.html"],
          title: "Accelerator and compiler overview"
        }
      ]
    },
    {
      title: "NPU architecture and compiler",
      pages: [
        {
          path: "npu-architecture-performance-study.html",
          title: "Architecture, operators, and verification"
        },
        {
          path: "npu-framework-compiler-skills.html",
          title: "Frontend compiler, IR, and code generation"
        },
        {
          path: "npu-soc-software-architecture.html",
          title: "Runtime and SoC software"
        },
        {
          path: "accelerator-repository-blueprint.html",
          title: "Product repository blueprint"
        }
      ]
    },
    {
      title: "Analog compute-in-memory",
      pages: [
        {
          path: "analog-cim-architecture.html",
          title: "Architecture and execution model"
        },
        {
          path: "analog-cim-evidence.html",
          title: "Accuracy evidence and open issues"
        },
        {
          path: "analog-cim-hardware-software-codesign.html",
          title: "Hardware and software co-design"
        },
        {
          path: "analog-cim-ihw-patents.html",
          title: "iHW patent study"
        },
        {
          path: "analog-cim-sdk-toolchain.html",
          title: "SDK and compiler toolchain"
        },
        {
          path: "analog-cim-board-bringup.html",
          title: "Board bring-up"
        },
        {
          path: "analog-cim-scaleout-llm.html",
          title: "Scale-out and LLM inference"
        },
        {
          path: "analog-cim-tenstorrent-reuse.html",
          title: "Tenstorrent reuse patterns"
        },
        {
          path: "analog-cim-mythic-videantis.html",
          title: "Mythic and Videantis case study"
        },
        {
          path: "analog-cim-interview.html",
          title: "Analog CIM interview study"
        },
        {
          path: "analog-cim-quiz.html",
          title: "Analog CIM quiz lab"
        }
      ]
    },
    {
      title: "Practice labs",
      pages: [
        {
          path: "interview-practice.html",
          title: "Interview practice hub"
        },
        {
          path: "deep-learning-practice.html",
          title: "Deep learning practice"
        },
        {
          path: "npu-practice.html",
          title: "AI compiler and NPU practice"
        },
        {
          path: "os-practice.html",
          title: "Operating systems practice"
        },
        {
          path: "embedded-practice.html",
          title: "Embedded systems practice"
        },
        {
          path: "c-practice.html",
          title: "C programming practice"
        },
        {
          path: "git-practice.html",
          title: "Git practice"
        }
      ]
    }
  ];

  const chapters = chapterGroups.flatMap((group) =>
    group.pages.map((page) => ({ ...page, groupTitle: group.title }))
  );

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

  function addHeadingAnchor(heading, targetId) {
    if (!heading || heading.querySelector(":scope > .book-heading-anchor")) return;
    if (!heading.hasAttribute("aria-label")) {
      heading.setAttribute("aria-label", heading.textContent.trim());
    }
    const anchor = makeElement("a", "book-heading-anchor", "#");
    anchor.href = `#${encodeURIComponent(targetId)}`;
    anchor.setAttribute("aria-label", `Link to ${heading.textContent.trim()}`);
    heading.append(" ", anchor);
  }

  function explicitSectionLabels(main) {
    const labels = new Map();
    const selectors = [
      "nav.toc a[href^='#']",
      "body > header:not(.book-topbar) nav a[href^='#']"
    ];
    for (const anchor of document.querySelectorAll(selectors.join(","))) {
      let url;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        continue;
      }
      if (url.pathname !== window.location.pathname || url.hash.length < 2) continue;
      const id = decodeURIComponent(url.hash.slice(1));
      if (main.querySelector(`#${CSS.escape(id)}`) && !labels.has(id)) {
        labels.set(id, anchor.textContent.trim());
      }
    }
    return labels;
  }

  function discoverSections(main) {
    const explicitLabels = explicitSectionLabels(main);
    const sectionCandidates = Array.from(
      main.querySelectorAll("section[id], article[id]")
    ).filter((candidate) => {
      const ancestor = candidate.parentElement?.closest("section[id], article[id]");
      return !ancestor || !main.contains(ancestor);
    });

    let targets = sectionCandidates;
    if (targets.length < 2 && explicitLabels.size > 1) {
      targets = Array.from(explicitLabels.keys())
        .map((id) => document.getElementById(id))
        .filter(Boolean);
    }

    const seen = new Set();
    return targets
      .filter((target) => {
        if (!target.id || seen.has(target.id)) return false;
        seen.add(target.id);
        return true;
      })
      .map((target) => {
        const heading = target.querySelector("h2, h3");
        const label =
          explicitLabels.get(target.id) ||
          heading?.textContent.trim() ||
          target.id.replace(/[-_]+/g, " ");
        addHeadingAnchor(heading, target.id);
        return { id: target.id, label, target };
      });
  }

  function createPageOutline(main, sections) {
    if (sections.length < 2) return { outline: null, links: new Map() };

    const outline = makeElement("details", "book-page-outline");
    outline.id = "book-page-outline";
    if (window.location.hash.length > 1) outline.open = true;

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

    for (const section of sections) {
      const item = makeElement("li", "book-page-outline-item");
      const anchor = makeElement("a", "book-page-outline-link", section.label);
      anchor.href = `#${encodeURIComponent(section.id)}`;
      item.append(anchor);
      list.append(item);
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
    const previous = chapters[currentIndex - 1];
    const next = chapters[currentIndex + 1];
    if (!previous && !next) return null;

    const pager = makeElement("nav", "book-pager");
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

  function initializeBookShell() {
    const body = document.body;
    const main = document.querySelector("main");
    if (!body || !main || body.classList.contains("book-shell-active")) return;

    const filename = currentFilename();
    const currentIndex = chapters.findIndex((page) => pageMatches(page, filename));
    if (currentIndex < 0) {
      root.dataset.bookShellReady = "unsupported";
      return;
    }

    const currentPage = chapters[currentIndex];
    if (/^(?:c|deep-learning|embedded|git|interview|os)-practice\.html$/.test(filename)) {
      body.classList.add("book-family-practice");
    }
    if (filename === "npu-practice.html") body.classList.add("book-family-npu-practice");

    if (!main.id) main.id = "book-main";
    if (!main.hasAttribute("tabindex")) main.tabIndex = -1;

    const skipLink = makeElement("a", "book-skip-link", "Skip to study content");
    skipLink.href = `#${encodeURIComponent(main.id)}`;
    skipLink.addEventListener("click", () => {
      window.setTimeout(() => main.focus({ preventScroll: true }), 0);
    });

    const topbar = makeElement("div", "book-topbar");
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
    const progressRow = makeElement("span", "book-chapter-progress-row");
    const chapterProgress = makeElement("progress", "book-chapter-progress");
    chapterProgress.max = chapters.length;
    chapterProgress.value = currentIndex + 1;
    chapterProgress.setAttribute("aria-label", "Current chapter position");
    progressRow.append(chapterProgress);
    progressRow.append(
      makeElement(
        "strong",
        "book-chapter-progress-text",
        `${currentIndex + 1} / ${chapters.length}`
      )
    );
    position.append(progressRow);

    const actions = makeElement("nav", "book-topbar-actions");
    actions.setAttribute("aria-label", "Study guide controls");
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

    actions.append(sourceLink);
    actions.append(themeButton);
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
    readingProgress.append(makeElement("span", "book-reading-progress-value"));
    topbar.append(readingProgress);

    const sidebar = makeElement("aside", "book-sidebar");
    sidebar.id = "book-sidebar";
    sidebar.setAttribute("aria-label", "NPU Study Guide chapters");
    sidebar.tabIndex = -1;

    const sidebarHeader = makeElement("div", "book-sidebar-header");
    sidebarHeader.append(makeElement("strong", "", "Study chapters"));
    sidebarHeader.append(
      makeElement("span", "", `${chapters.length} chapters · architecture to runtime`)
    );
    const sidebarClose = makeElement("button", "book-sidebar-close", "×");
    sidebarClose.type = "button";
    sidebarClose.setAttribute("aria-label", "Close study chapters");
    sidebarHeader.append(sidebarClose);
    sidebar.append(sidebarHeader);

    const chapterNavigation = makeElement("nav", "book-chapter-nav");
    chapterNavigation.setAttribute("aria-label", "Study chapters");
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

    const backdrop = makeElement("div", "book-drawer-backdrop");
    backdrop.setAttribute("aria-hidden", "true");

    body.prepend(backdrop);
    body.prepend(sidebar);
    body.prepend(topbar);
    body.prepend(skipLink);
    body.classList.add("book-shell-active");

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
    if (originalToc) originalToc.setAttribute("aria-hidden", "true");

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
      const progressValue = readingProgress.querySelector(
        ".book-reading-progress-value"
      );
      progressValue.style.transform = `scaleX(${boundedPercent / 100})`;
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
    window.addEventListener("hashchange", () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
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
      if (mobileSidebar.matches && event.target.closest("a")) closeDrawer(false);
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
      syncSidebarState();
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
        const targetTop =
          currentChapterLink.offsetTop -
          sidebar.clientHeight / 2 +
          currentChapterLink.clientHeight / 2;
        sidebar.scrollTop = Math.max(0, targetTop);
      }
      scheduleScrollUpdate();
      root.dataset.bookShellReady = "true";
      document.dispatchEvent(new CustomEvent("bookshellready"));
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeBookShell, { once: true });
  } else {
    initializeBookShell();
  }
})();
