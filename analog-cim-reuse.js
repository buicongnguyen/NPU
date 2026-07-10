(() => {
  const scorecard = document.querySelector('[data-reuse-scorecard]');
  if (!scorecard) return;

  const inputs = [...scorecard.querySelectorAll('[data-score]')];
  const total = scorecard.querySelector('[data-score-total]');
  const label = scorecard.querySelector('[data-score-label]');
  const guidance = scorecard.querySelector('[data-score-guidance]');
  const reset = scorecard.querySelector('[data-score-reset]');
  const storageKey = 'npu-study:acim-reuse-scorecard';
  const defaults = Object.fromEntries(inputs.map((input) => [input.dataset.score, input.value]));

  const recommendations = [
    {
      maximum: 2.19,
      label: 'Study only',
      guidance: 'Use the component as an architecture reference. Do not create a code or release dependency.'
    },
    {
      maximum: 3.19,
      label: 'Adapt only behind a boundary',
      guidance: 'Isolate the component and require a focused proof of concept before creating a product dependency.'
    },
    {
      maximum: 4.19,
      label: 'Pilot reuse candidate',
      guidance: 'Run legal, dependency, performance, and maintenance gates with a documented replacement path.'
    },
    {
      maximum: 5,
      label: 'Strong reuse candidate',
      guidance: 'Proceed to measured integration gates. The score does not replace legal approval or target validation.'
    }
  ];

  const load = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
      inputs.forEach((input) => {
        const value = Number(saved[input.dataset.score]);
        if (value >= Number(input.min) && value <= Number(input.max)) input.value = String(value);
      });
    } catch (_) {
      // The scorecard remains usable when storage is blocked or invalid.
    }
  };

  const render = () => {
    let weighted = 0;
    let weightSum = 0;
    const saved = {};

    inputs.forEach((input) => {
      const value = Number(input.value);
      const weight = Number(input.dataset.weight || 1);
      weighted += value * weight;
      weightSum += weight;
      saved[input.dataset.score] = value;
      const output = scorecard.querySelector(`output[for="${input.id}"]`);
      if (output) output.value = String(value);
    });

    const score = weightSum ? weighted / weightSum : 0;
    const recommendation = recommendations.find((item) => score <= item.maximum) || recommendations.at(-1);
    total.textContent = `${score.toFixed(1)} / 5`;
    label.textContent = recommendation.label;
    guidance.textContent = recommendation.guidance;

    try {
      localStorage.setItem(storageKey, JSON.stringify(saved));
    } catch (_) {
      // Persistence is optional; calculation still works in the current view.
    }
  };

  inputs.forEach((input) => input.addEventListener('input', render));
  reset.addEventListener('click', () => {
    inputs.forEach((input) => {
      input.value = defaults[input.dataset.score];
    });
    render();
  });

  load();
  render();
})();
