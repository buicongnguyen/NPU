(function () {
  const data = window.practicePageData;
  if (!data) return;

  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text) el.textContent = text;
    return el;
  }

  function link(href, text) {
    const a = node("a", "", text);
    a.href = href;
    a.target = href.startsWith("http") ? "_blank" : "";
    if (a.target) a.rel = "noopener noreferrer";
    return a;
  }

  function renderPlan() {
    const root = document.getElementById("plan-root");
    if (!root) return;
    for (const item of data.plans) {
      const card = node("article", "card");
      card.dataset.search = `${item.title} ${item.text}`.toLowerCase();
      card.appendChild(node("span", "tag", item.phase));
      card.appendChild(node("h3", "", item.title));
      card.appendChild(node("p", "", item.text));
      root.appendChild(card);
    }
  }

  function renderKnowledge() {
    const root = document.getElementById("knowledge-root");
    if (!root) return;
    for (const item of data.knowledge) {
      const card = node("article", "card");
      card.dataset.search = `${item.title} ${item.text}`.toLowerCase();
      card.appendChild(node("h3", "", item.title));
      card.appendChild(node("p", "", item.text));
      root.appendChild(card);
    }
  }

  function renderQuestions() {
    const root = document.getElementById("questions-root");
    if (!root) return;
    let count = 0;
    for (const group of data.groups) {
      const groupWrap = node("section", "qa-group");
      groupWrap.id = group.id;
      groupWrap.appendChild(node("h3", "", group.title));
      for (const q of group.questions) {
        count += 1;
        const card = node("details", "qa");
        card.dataset.search = `${group.title} ${q.q} ${q.choices.join(" ")} ${q.why}`.toLowerCase();
        const summary = node("summary", "", `${count}. ${q.q}`);
        summary.appendChild(node("span", "tag", group.tag));
        const answer = node("div", "answer");
        const ol = node("ol", "choices");
        ol.type = "A";
        q.choices.forEach((choice, index) => {
          const li = node("li", index === q.answer ? "correct" : "", choice);
          ol.appendChild(li);
        });
        answer.appendChild(ol);
        const why = node("p", "why", q.why);
        answer.appendChild(why);
        card.appendChild(summary);
        card.appendChild(answer);
        groupWrap.appendChild(card);
      }
      root.appendChild(groupWrap);
    }
  }

  function renderResources() {
    const root = document.getElementById("resources-root");
    if (!root) return;
    for (const item of data.resources) {
      const card = node("article", "card");
      card.appendChild(node("h3", "", item.title));
      const p = node("p", "");
      p.appendChild(document.createTextNode(item.text + " "));
      item.links.forEach((l, i) => {
        if (i > 0) p.appendChild(document.createTextNode(" | "));
        p.appendChild(link(l.href, l.label));
      });
      card.appendChild(p);
      root.appendChild(card);
    }
  }

  function totalQuestions() {
    return data.groups.reduce((sum, g) => sum + g.questions.length, 0);
  }

  function filterAll() {
    const q = document.getElementById("search").value.trim().toLowerCase();
    let shown = 0;
    for (const el of document.querySelectorAll("[data-search]")) {
      const match = !q || el.dataset.search.includes(q);
      el.classList.toggle("hidden", !match);
      if (match && el.classList.contains("qa")) shown += 1;
    }
    document.getElementById("stats").textContent = q
      ? `${shown} matching questions`
      : `${totalQuestions()} questions across ${data.groups.length} categories`;
  }

  renderPlan();
  renderKnowledge();
  renderQuestions();
  renderResources();
  document.getElementById("search").addEventListener("input", filterAll);
  filterAll();
}());
