(() => {
  const activateTab = (tabset, nextTab) => {
    const tabs = [...tabset.querySelectorAll('[role="tab"]')];
    const panels = [...tabset.querySelectorAll('[role="tabpanel"]')];

    tabs.forEach((tab) => {
      const selected = tab === nextTab;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });

    panels.forEach((panel) => {
      panel.hidden = panel.id !== nextTab.getAttribute('aria-controls');
    });
  };

  document.querySelectorAll('[data-tabset]').forEach((tabset) => {
    const tabs = [...tabset.querySelectorAll('[role="tab"]')];
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => activateTab(tabset, tab));
      tab.addEventListener('keydown', (event) => {
        const keyToIndex = {
          ArrowDown: (index + 1) % tabs.length,
          ArrowRight: (index + 1) % tabs.length,
          ArrowUp: (index - 1 + tabs.length) % tabs.length,
          ArrowLeft: (index - 1 + tabs.length) % tabs.length,
          Home: 0,
          End: tabs.length - 1
        };
        if (!(event.key in keyToIndex)) return;
        event.preventDefault();
        const next = tabs[keyToIndex[event.key]];
        activateTab(tabset, next);
        next.focus();
      });
    });
  });

  document.querySelectorAll('[data-filter-group]').forEach((group) => {
    const targetId = group.getAttribute('data-filter-group');
    const target = document.getElementById(targetId);
    if (!target) return;

    const buttons = [...group.querySelectorAll('[data-filter]')];
    const cards = [...target.querySelectorAll('[data-domain]')];
    buttons.forEach((button) => {
      button.addEventListener('click', () => {
        const filter = button.getAttribute('data-filter');
        buttons.forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
        cards.forEach((card) => {
          const domains = (card.getAttribute('data-domain') || '').split(' ');
          card.hidden = filter !== 'all' && !domains.includes(filter);
        });
      });
    });
  });

  document.querySelectorAll('[data-progress]').forEach((tracker) => {
    const storageKey = `npu-study:${tracker.getAttribute('data-progress')}`;
    const checks = [...tracker.querySelectorAll('input[type="checkbox"][data-step]')];
    const bar = tracker.querySelector('[data-progress-bar]');
    const value = tracker.querySelector('[data-progress-value]');

    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
    } catch (_) {
      saved = {};
    }

    const render = () => {
      const completed = checks.filter((check) => check.checked).length;
      const percent = checks.length ? Math.round((completed / checks.length) * 100) : 0;
      if (bar) {
        if (bar instanceof HTMLProgressElement) {
          bar.value = percent;
          bar.textContent = `${percent}%`;
        } else {
          bar.style.width = `${percent}%`;
          bar.setAttribute('aria-valuenow', String(percent));
        }
      }
      if (value) value.textContent = `${completed} / ${checks.length} complete`;
    };

    checks.forEach((check) => {
      check.checked = Boolean(saved[check.getAttribute('data-step')]);
      check.addEventListener('change', () => {
        saved[check.getAttribute('data-step')] = check.checked;
        try {
          localStorage.setItem(storageKey, JSON.stringify(saved));
        } catch (_) {
          // Progress still works for the current page view when storage is unavailable.
        }
        render();
      });
    });

    render();
  });
})();
