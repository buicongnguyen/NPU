(function () {
  'use strict';

  var data;
  var questions = [];
  var index = 0;
  var selected = null;
  var locked = false;
  var score = 0;
  var answered = 0;

  var topicSelect = document.getElementById('topic-filter');
  var difficultySelect = document.getElementById('difficulty-filter');
  var shuffleButton = document.getElementById('shuffle-quiz');
  var resetButton = document.getElementById('reset-quiz');
  var progressLabel = document.getElementById('progress-label');
  var progressBar = document.getElementById('progress-bar');
  var scoreLabel = document.getElementById('score-label');
  var body = document.getElementById('quiz-body');

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function unique(values) {
    return values.filter(function (value, position) {
      return values.indexOf(value) === position;
    }).sort();
  }

  function addOptions(select, values) {
    values.forEach(function (value) {
      var option = element('option', '', value);
      option.value = value;
      select.appendChild(option);
    });
  }

  function shuffle(list) {
    var copy = list.slice();
    for (var i = copy.length - 1; i > 0; i -= 1) {
      var j = Math.floor(Math.random() * (i + 1));
      var temporary = copy[i];
      copy[i] = copy[j];
      copy[j] = temporary;
    }
    return copy;
  }

  function updateStatus() {
    var total = questions.length;
    progressLabel.textContent = total ? (Math.min(index + 1, total) + ' / ' + total) : '0 / 0';
    scoreLabel.textContent = 'Score ' + score + ' / ' + answered;
    progressBar.style.width = total ? ((answered / total) * 100) + '%' : '0%';
  }

  function sourceLinks(question) {
    var container = element('p', 'muted');
    container.appendChild(document.createTextNode('Sources: '));
    question.sourceIds.forEach(function (sourceId, sourceIndex) {
      var source = data.sources[sourceId];
      if (!source) return;
      if (sourceIndex > 0) container.appendChild(document.createTextNode(' | '));
      var link = element('a', '', source.title);
      link.href = source.url;
      container.appendChild(link);
    });
    return container;
  }

  function renderSummary() {
    updateStatus();
    var wrap = element('div', 'empty-state');
    var content = element('div');
    content.append(
      element('p', 'kicker', 'Set complete'),
      element('h2', '', score + ' correct out of ' + questions.length),
      element('p', 'muted', score === questions.length
        ? 'Every answer is correct. Explain each tradeoff aloud before calling it mastered.'
        : 'Review the explanations, then run the same filtered set again or change the topic.')
    );
    var restart = element('button', 'button', 'Run this set again');
    restart.type = 'button';
    restart.addEventListener('click', function () {
      startSet(false);
    });
    content.appendChild(restart);
    wrap.appendChild(content);
    body.replaceChildren(wrap);
  }

  function renderQuestion() {
    if (!questions.length) {
      body.replaceChildren(element('div', 'empty-state', 'No questions match these filters.'));
      updateStatus();
      return;
    }

    if (index >= questions.length) {
      renderSummary();
      return;
    }

    selected = null;
    locked = false;
    var question = questions[index];
    var displayedChoices = shuffle(question.choices.map(function (choice, originalIndex) {
      return { text: choice, originalIndex: originalIndex };
    }));
    var meta = element('div', 'quiz-meta');
    meta.append(
      element('span', 'tag status-measured', question.topic),
      element('span', 'tag status-conditional', question.difficulty),
      element('span', 'tag', question.id)
    );

    var title = element('h2', 'quiz-question', question.prompt);
    var options = element('div', 'option-list');
    options.setAttribute('role', 'radiogroup');
    options.setAttribute('aria-label', 'Answer choices');
    var optionButtons = [];
    var letters = ['A', 'B', 'C', 'D', 'E', 'F'];

    displayedChoices.forEach(function (choice, choiceIndex) {
      var option = element('button', 'option');
      option.type = 'button';
      option.setAttribute('role', 'radio');
      option.setAttribute('aria-checked', 'false');
      option.append(element('span', 'option-key', letters[choiceIndex]), element('span', '', choice.text));
      option.addEventListener('click', function () {
        if (locked) return;
        selected = choiceIndex;
        optionButtons.forEach(function (button, buttonIndex) {
          button.setAttribute('aria-checked', buttonIndex === selected ? 'true' : 'false');
        });
        checkButton.disabled = false;
      });
      optionButtons.push(option);
      options.appendChild(option);
    });

    var feedback = element('div', 'quiz-feedback');
    feedback.id = 'quiz-feedback';
    feedback.setAttribute('aria-live', 'polite');
    feedback.hidden = true;

    var actions = element('div', 'quiz-actions');
    var checkButton = element('button', 'button', 'Check answer');
    checkButton.type = 'button';
    checkButton.disabled = true;
    var nextButton = element('button', 'button secondary', index === questions.length - 1 ? 'Finish set' : 'Next question');
    nextButton.type = 'button';
    nextButton.disabled = true;

    checkButton.addEventListener('click', function () {
      if (selected === null || locked) return;
      locked = true;
      answered += 1;
      var correct = displayedChoices[selected].originalIndex === question.answer;
      if (correct) score += 1;

      optionButtons.forEach(function (button, choiceIndex) {
        button.disabled = true;
        if (displayedChoices[choiceIndex].originalIndex === question.answer) button.classList.add('correct');
        if (choiceIndex === selected && !correct) button.classList.add('incorrect');
      });

      feedback.hidden = false;
      feedback.replaceChildren(
        element('strong', '', correct ? 'Correct. ' : 'Not quite. '),
        document.createTextNode(question.explanation),
        sourceLinks(question)
      );
      checkButton.disabled = true;
      nextButton.disabled = false;
      updateStatus();
      nextButton.focus();
    });

    nextButton.addEventListener('click', function () {
      if (!locked) return;
      index += 1;
      renderQuestion();
    });

    actions.append(checkButton, nextButton);
    body.replaceChildren(meta, title, options, feedback, actions);
    updateStatus();
  }

  function matchingQuestions() {
    var topic = topicSelect.value;
    var difficulty = difficultySelect.value;
    return data.questions.filter(function (question) {
      return (topic === 'All topics' || question.topic === topic) &&
        (difficulty === 'All levels' || question.difficulty === difficulty);
    });
  }

  function startSet(shouldShuffle) {
    questions = matchingQuestions();
    if (shouldShuffle) questions = shuffle(questions);
    index = 0;
    selected = null;
    locked = false;
    score = 0;
    answered = 0;
    renderQuestion();
  }

  function loadQuiz() {
    fetch('data/analog-cim-mcq.json')
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (loadedData) {
        data = loadedData;
        addOptions(topicSelect, unique(data.questions.map(function (question) { return question.topic; })));
        addOptions(difficultySelect, unique(data.questions.map(function (question) { return question.difficulty; })));
        topicSelect.disabled = false;
        difficultySelect.disabled = false;
        shuffleButton.disabled = false;
        resetButton.disabled = false;
        startSet(false);
      })
      .catch(function (error) {
        body.replaceChildren(element('div', 'empty-state', 'Quiz data could not be loaded: ' + error.message));
      });
  }

  topicSelect.addEventListener('change', function () { startSet(false); });
  difficultySelect.addEventListener('change', function () { startSet(false); });
  shuffleButton.addEventListener('click', function () { startSet(true); });
  resetButton.addEventListener('click', function () { startSet(false); });

  loadQuiz();
}());
