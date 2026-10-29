// The picture check's classifier: logistic regression on CLIP embeddings.
// Shared by background.js (retrains from your corrections) and eval/probe.mjs.
/* exported SlopTrain */

var SlopTrain = (() => {
  // X: unit-length embeddings, y: 1 = AI, 0 = real. sampleWeight lets your own
  // corrections count for more than the shipped examples. Both classes end up with
  // equal total weight, so having more of one kind doesn't tilt it.
  function train(X, y, { sampleWeight, lambda = 1e-3, iters = 400, lr = 2 } = {}) {
    const n = X.length;
    const d = X[0].length;
    const scale = Math.sqrt(d); // embeddings are unit length; spread them out
    const sw = sampleWeight || X.map(() => 1);
    const total = [0, 0];
    y.forEach((t, i) => (total[t] += sw[i]));
    const cw = y.map((t, i) => (sw[i] * (total[0] + total[1])) / (2 * total[t]));

    const w = new Float64Array(d);
    let b = 0;
    for (let it = 0; it < iters; it++) {
      const gw = new Float64Array(d);
      let gb = 0;
      for (let i = 0; i < n; i++) {
        const x = X[i];
        let z = b;
        for (let j = 0; j < d; j++) z += w[j] * x[j] * scale;
        const err = (1 / (1 + Math.exp(-z)) - y[i]) * cw[i];
        for (let j = 0; j < d; j++) gw[j] += err * x[j] * scale;
        gb += err;
      }
      for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / n + lambda * w[j]);
      b -= (lr * gb) / n;
    }
    return { scale, bias: +b.toFixed(6), weights: Array.from(w, (v) => +v.toFixed(6)) };
  }

  // Probability (0–1) that embedding x is AI-made.
  function score(model, x) {
    let z = model.bias;
    for (let j = 0; j < x.length; j++) z += model.weights[j] * x[j] * model.scale;
    return 1 / (1 + Math.exp(-z));
  }

  return { train, score };
})();
