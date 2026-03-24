/**
 * Modèle ML de prédiction de remplissage CAV
 * Régression linéaire multivariée avec descente de gradient
 *
 * Features:
 *   0 - day_of_week      : jour de la semaine (0=dimanche, 6=samedi)
 *   1 - month            : mois (1-12)
 *   2 - days_since_collection : jours depuis dernière collecte
 *   3 - historical_avg   : moyenne historique de remplissage du CAV
 *   4 - nb_containers    : nombre de conteneurs sur le point
 *   5 - is_vacation      : période de vacances scolaires (0 ou 1)
 *   6 - temperature      : température max du jour (°C)
 */

class FillRateModel {
  constructor() {
    this.weights = null;
    this.bias = 0;
    this.featureNames = [
      'day_of_week',
      'month',
      'days_since_collection',
      'historical_avg',
      'nb_containers',
      'is_vacation',
      'temperature',
    ];
    this.mean = null;
    this.std = null;
    this.trained = false;
    this.metadata = {
      trainedAt: null,
      samples: 0,
      mse: null,
      r2: null,
      epochs: 0,
      learningRate: 0,
    };
  }

  /**
   * Normalize features using z-score: (x - mean) / std
   * If mean/std not yet computed, compute from data matrix X
   * @param {number[][]} X - feature matrix (rows = samples, cols = features)
   * @param {boolean} fit - if true, compute mean/std from X
   * @returns {number[][]} normalized feature matrix
   */
  normalize(X, fit = false) {
    const nFeatures = X[0].length;

    if (fit) {
      this.mean = new Array(nFeatures).fill(0);
      this.std = new Array(nFeatures).fill(0);

      // Compute means
      for (let j = 0; j < nFeatures; j++) {
        let sum = 0;
        for (let i = 0; i < X.length; i++) {
          sum += X[i][j];
        }
        this.mean[j] = sum / X.length;
      }

      // Compute standard deviations
      for (let j = 0; j < nFeatures; j++) {
        let sumSq = 0;
        for (let i = 0; i < X.length; i++) {
          const diff = X[i][j] - this.mean[j];
          sumSq += diff * diff;
        }
        this.std[j] = Math.sqrt(sumSq / X.length);
        // Avoid division by zero for constant features
        if (this.std[j] < 1e-8) {
          this.std[j] = 1;
        }
      }
    }

    // Apply normalization
    const Xn = [];
    for (let i = 0; i < X.length; i++) {
      const row = new Array(nFeatures);
      for (let j = 0; j < nFeatures; j++) {
        row[j] = (X[i][j] - this.mean[j]) / this.std[j];
      }
      Xn.push(row);
    }
    return Xn;
  }

  /**
   * Train the model with batch gradient descent
   * @param {number[][]} X - feature matrix (N x F)
   * @param {number[]} y - target values (fill rates 0-100)
   * @param {number} learningRate - step size for gradient descent
   * @param {number} epochs - number of training iterations
   * @returns {{ mse: number, r2: number, history: number[] }} training metrics
   */
  train(X, y, learningRate = 0.01, epochs = 1000) {
    if (!X || X.length === 0 || !y || y.length === 0) {
      throw new Error('Données d\'entraînement vides');
    }
    if (X.length !== y.length) {
      throw new Error('X et y doivent avoir le même nombre d\'échantillons');
    }

    const N = X.length;
    const F = X[0].length;

    // Normalize features (fit on training data)
    const Xn = this.normalize(X, true);

    // Initialize weights to small random values
    this.weights = new Array(F);
    for (let j = 0; j < F; j++) {
      this.weights[j] = (Math.random() - 0.5) * 0.1;
    }
    this.bias = 0;

    const lossHistory = [];

    for (let epoch = 0; epoch < epochs; epoch++) {
      // Forward pass: predictions = Xn * weights + bias
      const predictions = new Array(N);
      for (let i = 0; i < N; i++) {
        let pred = this.bias;
        for (let j = 0; j < F; j++) {
          pred += Xn[i][j] * this.weights[j];
        }
        predictions[i] = pred;
      }

      // Compute gradients
      const gradW = new Array(F).fill(0);
      let gradB = 0;

      for (let i = 0; i < N; i++) {
        const error = predictions[i] - y[i];
        for (let j = 0; j < F; j++) {
          gradW[j] += (2 / N) * error * Xn[i][j];
        }
        gradB += (2 / N) * error;
      }

      // Update weights and bias
      for (let j = 0; j < F; j++) {
        this.weights[j] -= learningRate * gradW[j];
      }
      this.bias -= learningRate * gradB;

      // Record loss every 100 epochs
      if (epoch % 100 === 0 || epoch === epochs - 1) {
        let mse = 0;
        for (let i = 0; i < N; i++) {
          const err = predictions[i] - y[i];
          mse += err * err;
        }
        mse /= N;
        lossHistory.push({ epoch, mse });
      }
    }

    // Final metrics
    const finalPredictions = new Array(N);
    for (let i = 0; i < N; i++) {
      let pred = this.bias;
      for (let j = 0; j < F; j++) {
        pred += Xn[i][j] * this.weights[j];
      }
      finalPredictions[i] = pred;
    }

    const mse = this._computeMSE(finalPredictions, y);
    const r2 = this._computeR2(finalPredictions, y);

    this.trained = true;
    this.metadata = {
      trainedAt: new Date().toISOString(),
      samples: N,
      mse,
      r2,
      epochs,
      learningRate,
    };

    return { mse, r2, history: lossHistory };
  }

  /**
   * Predict fill rate for a single feature vector
   * @param {number[]} features - raw feature values (not normalized)
   * @returns {number} predicted fill rate (clamped 0-100)
   */
  predict(features) {
    if (!this.trained) {
      throw new Error('Le modèle n\'est pas encore entraîné');
    }
    if (features.length !== this.weights.length) {
      throw new Error(`Attendu ${this.weights.length} features, reçu ${features.length}`);
    }

    // Normalize the input using stored mean/std
    const normalized = new Array(features.length);
    for (let j = 0; j < features.length; j++) {
      normalized[j] = (features[j] - this.mean[j]) / this.std[j];
    }

    // Linear prediction
    let pred = this.bias;
    for (let j = 0; j < this.weights.length; j++) {
      pred += normalized[j] * this.weights[j];
    }

    // Clamp to 0-100%
    return Math.max(0, Math.min(100, pred));
  }

  /**
   * Predict for multiple samples
   * @param {number[][]} X - feature matrix
   * @returns {number[]} predictions
   */
  predictBatch(X) {
    return X.map(features => this.predict(features));
  }

  /**
   * Mean Squared Error
   */
  _computeMSE(predictions, actual) {
    let sum = 0;
    for (let i = 0; i < predictions.length; i++) {
      const err = predictions[i] - actual[i];
      sum += err * err;
    }
    return sum / predictions.length;
  }

  /**
   * R² (coefficient of determination)
   */
  _computeR2(predictions, actual) {
    const n = actual.length;
    let meanY = 0;
    for (let i = 0; i < n; i++) {
      meanY += actual[i];
    }
    meanY /= n;

    let ssRes = 0;
    let ssTot = 0;
    for (let i = 0; i < n; i++) {
      ssRes += (actual[i] - predictions[i]) ** 2;
      ssTot += (actual[i] - meanY) ** 2;
    }

    if (ssTot < 1e-8) return 0;
    return 1 - ssRes / ssTot;
  }

  /**
   * Serialize model to JSON for storage
   * @returns {object}
   */
  toJSON() {
    return {
      weights: this.weights,
      bias: this.bias,
      featureNames: this.featureNames,
      mean: this.mean,
      std: this.std,
      trained: this.trained,
      metadata: this.metadata,
    };
  }

  /**
   * Deserialize model from JSON
   * @param {object} json
   * @returns {FillRateModel}
   */
  static fromJSON(json) {
    const model = new FillRateModel();
    model.weights = json.weights;
    model.bias = json.bias;
    model.featureNames = json.featureNames || model.featureNames;
    model.mean = json.mean;
    model.std = json.std;
    model.trained = json.trained;
    model.metadata = json.metadata;
    return model;
  }
}

module.exports = FillRateModel;
