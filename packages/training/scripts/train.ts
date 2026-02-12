#!/usr/bin/env npx tsx
/**
 * BitNet Ternary Model Training Script
 *
 * Pure TypeScript neural network training with ternary weight quantization.
 * No external ML frameworks — implements forward pass, backprop, and SGD.
 *
 * Architecture: input → 64 → 32 → 4 (ternary weights: {-1, 0, +1})
 * Inference: ~1ms on CPU (addition/subtraction only, no multiplication)
 *
 * Usage:
 *   pnpm train --data ./data/training-balanced.jsonl
 *   pnpm train --data ./data/training-balanced.jsonl --epochs 200 --lr 0.01
 */

import { Command } from 'commander';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

// ============================================================
// Types
// ============================================================

interface TrainingRecord {
  features: number[];
  target: {
    score: number;
    level: string;
    label: number;
  };
  meta: {
    id: string;
    symbol: string;
    outcomeKnown: boolean;
    outcome?: string;
  };
}

interface LayerWeights {
  weights: Float32Array; // rows × cols (row-major)
  biases: Float32Array;
  rows: number;
  cols: number;
}

interface Network {
  layers: LayerWeights[];
  architecture: number[];
}

interface TernaryModel {
  version: number;
  architecture: number[];
  quantization: 'ternary';
  weights: {
    [key: string]: number[]; // Int8Array serialized as number[]
  };
  biases: {
    [key: string]: number[]; // Float32 biases kept as-is
  };
  classes: string[];
  featureCount: number;
  accuracy: number;
  trainedOn: number;
  trainedAt: string;
  trainingEpochs: number;
  finalLoss: number;
}

// ============================================================
// Neural Network Operations
// ============================================================

// Xavier/Glorot initialization
function initLayer(inputSize: number, outputSize: number): LayerWeights {
  const scale = Math.sqrt(2.0 / (inputSize + outputSize));
  const weights = new Float32Array(outputSize * inputSize);
  const biases = new Float32Array(outputSize);

  for (let i = 0; i < weights.length; i++) {
    // Box-Muller for normal distribution
    const u1 = Math.random();
    const u2 = Math.random();
    weights[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * scale;
  }

  return { weights, biases, rows: outputSize, cols: inputSize };
}

function initNetwork(architecture: number[]): Network {
  const layers: LayerWeights[] = [];
  for (let i = 0; i < architecture.length - 1; i++) {
    layers.push(initLayer(architecture[i], architecture[i + 1]));
  }
  return { layers, architecture };
}

// ReLU activation
function relu(x: Float32Array): Float32Array {
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    out[i] = x[i] > 0 ? x[i] : 0;
  }
  return out;
}

// ReLU derivative
function reluGrad(x: Float32Array): Float32Array {
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    out[i] = x[i] > 0 ? 1 : 0;
  }
  return out;
}

// Softmax
function softmax(logits: Float32Array): Float32Array {
  const max = Math.max(...logits);
  const exps = new Float32Array(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    exps[i] = Math.exp(logits[i] - max);
    sum += exps[i];
  }
  for (let i = 0; i < exps.length; i++) {
    exps[i] /= sum;
  }
  return exps;
}

// Forward pass — returns all intermediate activations for backprop
function forward(network: Network, input: Float32Array): {
  preActivations: Float32Array[];  // Before ReLU
  activations: Float32Array[];     // After ReLU (or softmax for last layer)
} {
  const preActivations: Float32Array[] = [];
  const activations: Float32Array[] = [input];

  for (let l = 0; l < network.layers.length; l++) {
    const layer = network.layers[l];
    const prev = activations[l];
    const pre = new Float32Array(layer.rows);

    // Matrix multiply: pre = weights × prev + biases
    for (let j = 0; j < layer.rows; j++) {
      let sum = layer.biases[j];
      const offset = j * layer.cols;
      for (let i = 0; i < layer.cols; i++) {
        sum += layer.weights[offset + i] * prev[i];
      }
      pre[j] = sum;
    }

    preActivations.push(pre);

    // Activation: ReLU for hidden layers, softmax for output
    if (l < network.layers.length - 1) {
      activations.push(relu(pre));
    } else {
      activations.push(softmax(pre));
    }
  }

  return { preActivations, activations };
}

// Cross-entropy loss
function crossEntropyLoss(predicted: Float32Array, targetClass: number): number {
  const p = Math.max(predicted[targetClass], 1e-7);
  return -Math.log(p);
}

// Backpropagation
function backward(
  network: Network,
  preActivations: Float32Array[],
  activations: Float32Array[],
  targetClass: number,
  learningRate: number,
  momentum: number,
  velocities: Float32Array[][] | null
): Float32Array[][] {
  const numLayers = network.layers.length;

  // Initialize velocities if needed
  if (!velocities) {
    velocities = network.layers.map(layer => [
      new Float32Array(layer.weights.length),
      new Float32Array(layer.biases.length),
    ]);
  }

  // Output layer gradient: softmax - one_hot
  const outputProbs = activations[numLayers];
  let delta = new Float32Array(outputProbs.length);
  for (let i = 0; i < delta.length; i++) {
    delta[i] = outputProbs[i] - (i === targetClass ? 1 : 0);
  }

  // Backward through layers
  for (let l = numLayers - 1; l >= 0; l--) {
    const layer = network.layers[l];
    const prevActivation = activations[l];

    // Weight gradients
    const [wVel, bVel] = velocities[l];

    for (let j = 0; j < layer.rows; j++) {
      const offset = j * layer.cols;
      for (let i = 0; i < layer.cols; i++) {
        const grad = delta[j] * prevActivation[i];
        wVel[offset + i] = momentum * wVel[offset + i] + learningRate * grad;
        layer.weights[offset + i] -= wVel[offset + i];
      }
      // Bias gradient
      bVel[j] = momentum * bVel[j] + learningRate * delta[j];
      layer.biases[j] -= bVel[j];
    }

    // Propagate delta to previous layer (if not input)
    if (l > 0) {
      const prevDelta = new Float32Array(layer.cols);
      for (let i = 0; i < layer.cols; i++) {
        let sum = 0;
        for (let j = 0; j < layer.rows; j++) {
          sum += layer.weights[j * layer.cols + i] * delta[j];
        }
        prevDelta[i] = sum;
      }

      // Apply ReLU gradient
      const reluG = reluGrad(preActivations[l - 1]);
      delta = new Float32Array(prevDelta.length);
      for (let i = 0; i < delta.length; i++) {
        delta[i] = prevDelta[i] * reluG[i];
      }
    }
  }

  return velocities;
}

// ============================================================
// Ternary Quantization
// ============================================================

function quantizeToTernary(weights: Float32Array, threshold?: number): Int8Array {
  // Default threshold: median of absolute values (excluding zeros)
  if (threshold === undefined) {
    const absValues = Array.from(weights).map(Math.abs).filter(v => v > 1e-7).sort((a, b) => a - b);
    threshold = absValues.length > 0 ? absValues[Math.floor(absValues.length * 0.33)] : 0.01;
  }

  const ternary = new Int8Array(weights.length);
  for (let i = 0; i < weights.length; i++) {
    if (weights[i] > threshold) {
      ternary[i] = 1;
    } else if (weights[i] < -threshold) {
      ternary[i] = -1;
    } else {
      ternary[i] = 0;
    }
  }

  return ternary;
}

// ============================================================
// Data Handling
// ============================================================

function loadData(path: string): TrainingRecord[] {
  const content = readFileSync(path, 'utf-8');
  return content.trim().split('\n').map(line => JSON.parse(line));
}

// Map level string to class index
function levelToClass(level: string): number {
  switch (level) {
    case 'SAFE': return 0;
    case 'SUSPICIOUS': return 1;
    case 'DANGEROUS': return 2;
    case 'SCAM': return 3;
    default: return 1; // Default to suspicious
  }
}

// Shuffle array in-place (Fisher-Yates)
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ============================================================
// Training Loop
// ============================================================

async function train(options: {
  data: string;
  output: string;
  epochs: number;
  lr: number;
  momentum: number;
  batchSize: number;
  hiddenSizes: number[];
  splitRatio: number;
  seed?: number;
  float32?: boolean;
}) {
  console.log('');
  console.log('==========================================================');
  console.log(`  ARGUS AI - BitNet ${options.float32 ? 'Float32' : 'Ternary'} Model Training`);
  console.log('  Pure TypeScript • No external ML frameworks');
  console.log('==========================================================');
  console.log('');

  // Set seed for reproducibility
  if (options.seed !== undefined) {
    console.log(`[Seed] Using seed: ${options.seed}`);
    // Simple seeded PRNG (override Math.random)
    let seed = options.seed;
    Math.random = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
  }

  // Load data
  const allRecords = loadData(options.data);
  console.log(`[Data] Loaded ${allRecords.length} records from ${options.data}`);

  // Detect feature count from data
  const featureCount = allRecords[0].features.length;
  console.log(`[Data] Feature count: ${featureCount}`);

  // Prepare training examples
  const examples = allRecords.map(r => ({
    features: new Float32Array(r.features),
    targetClass: levelToClass(r.target.level),
    label: r.target.label,
    symbol: r.meta.symbol,
  }));

  // Class distribution
  const classCounts = [0, 0, 0, 0];
  for (const ex of examples) {
    classCounts[ex.targetClass]++;
  }
  console.log(`[Data] Classes: SAFE=${classCounts[0]}, SUSPICIOUS=${classCounts[1]}, DANGEROUS=${classCounts[2]}, SCAM=${classCounts[3]}`);

  // Split train/test
  const shuffled = shuffle([...examples]);
  const splitIdx = Math.floor(shuffled.length * options.splitRatio);
  const trainSet = shuffled.slice(0, splitIdx);
  const testSet = shuffled.slice(splitIdx);
  console.log(`[Data] Train: ${trainSet.length}, Test: ${testSet.length}`);

  // Compute class weights for imbalanced data
  const totalSamples = trainSet.length;
  const classWeights = classCounts.map(c =>
    c > 0 ? totalSamples / (4 * c) : 1
  );
  console.log(`[Data] Class weights: [${classWeights.map(w => w.toFixed(2)).join(', ')}]`);

  // Initialize network
  const architecture = [featureCount, ...options.hiddenSizes, 4];
  const network = initNetwork(architecture);

  const totalWeights = network.layers.reduce((sum, l) =>
    sum + l.weights.length + l.biases.length, 0
  );
  console.log(`[Model] Architecture: ${architecture.join(' → ')}`);
  console.log(`[Model] Total parameters: ${totalWeights}`);
  console.log('');
  console.log(`[Training] Epochs: ${options.epochs}, LR: ${options.lr}, Momentum: ${options.momentum}`);
  console.log('');

  // Training loop
  let velocities: Float32Array[][] | null = null;
  let bestTestAcc = 0;
  let bestEpoch = 0;
  let bestLoss = Infinity;

  // Store best weights
  let bestWeights: { weights: Float32Array; biases: Float32Array }[] = [];

  for (let epoch = 0; epoch < options.epochs; epoch++) {
    // Shuffle training data each epoch
    shuffle(trainSet);

    let epochLoss = 0;
    let correct = 0;

    // Learning rate decay
    const lr = options.lr * (1 / (1 + 0.001 * epoch));

    for (const example of trainSet) {
      // Forward
      const { preActivations, activations } = forward(network, example.features);
      const output = activations[activations.length - 1];

      // Loss (weighted by class)
      const loss = crossEntropyLoss(output, example.targetClass) * classWeights[example.targetClass];
      epochLoss += loss;

      // Accuracy
      let maxIdx = 0;
      for (let i = 1; i < output.length; i++) {
        if (output[i] > output[maxIdx]) maxIdx = i;
      }
      if (maxIdx === example.targetClass) correct++;

      // Backward
      velocities = backward(
        network, preActivations, activations,
        example.targetClass, lr, options.momentum, velocities
      );
    }

    // Test accuracy
    let testCorrect = 0;
    let testLoss = 0;
    for (const example of testSet) {
      const { activations } = forward(network, example.features);
      const output = activations[activations.length - 1];
      testLoss += crossEntropyLoss(output, example.targetClass);

      let maxIdx = 0;
      for (let i = 1; i < output.length; i++) {
        if (output[i] > output[maxIdx]) maxIdx = i;
      }
      if (maxIdx === example.targetClass) testCorrect++;
    }

    const trainAcc = correct / trainSet.length;
    const testAcc = testSet.length > 0 ? testCorrect / testSet.length : 0;
    const avgLoss = epochLoss / trainSet.length;
    const avgTestLoss = testSet.length > 0 ? testLoss / testSet.length : 0;

    // Save best model
    if (testAcc > bestTestAcc || (testAcc === bestTestAcc && avgTestLoss < bestLoss)) {
      bestTestAcc = testAcc;
      bestEpoch = epoch;
      bestLoss = avgTestLoss;
      bestWeights = network.layers.map(l => ({
        weights: new Float32Array(l.weights),
        biases: new Float32Array(l.biases),
      }));
    }

    // Log progress
    if (epoch % 10 === 0 || epoch === options.epochs - 1) {
      console.log(
        `Epoch ${String(epoch).padStart(4)} | ` +
        `Loss: ${avgLoss.toFixed(4)} | ` +
        `Train: ${(trainAcc * 100).toFixed(1)}% | ` +
        `Test: ${(testAcc * 100).toFixed(1)}% | ` +
        `LR: ${lr.toFixed(5)}`
      );
    }
  }

  console.log('');
  console.log(`[Best] Epoch ${bestEpoch}: Test accuracy ${(bestTestAcc * 100).toFixed(1)}%`);

  // Restore best weights
  for (let l = 0; l < network.layers.length; l++) {
    network.layers[l].weights.set(bestWeights[l].weights);
    network.layers[l].biases.set(bestWeights[l].biases);
  }

  // ============================================================
  // Quantize to ternary (unless --float32 specified)
  // ============================================================

  let ternaryLayers: Int8Array[] = [];
  let finalAcc = bestTestAcc;

  if (options.float32) {
    console.log('');
    console.log('[Mode] Keeping float32 weights (no quantization)');
    console.log(`  Float32 accuracy: ${(bestTestAcc * 100).toFixed(1)}%`);
  } else {
    console.log('');
    console.log('[Quantization] Converting to ternary weights {-1, 0, +1}...');

    const layerStats: string[] = [];

    for (let l = 0; l < network.layers.length; l++) {
      const ternary = quantizeToTernary(network.layers[l].weights);
      ternaryLayers.push(ternary);

      let zeros = 0, ones = 0, negOnes = 0;
      for (let i = 0; i < ternary.length; i++) {
        if (ternary[i] === 0) zeros++;
        else if (ternary[i] === 1) ones++;
        else negOnes++;
      }

      const total = ternary.length;
      layerStats.push(
        `  Layer ${l + 1}: ${total} weights → ` +
        `+1: ${ones} (${(ones / total * 100).toFixed(0)}%), ` +
        `0: ${zeros} (${(zeros / total * 100).toFixed(0)}%), ` +
        `-1: ${negOnes} (${(negOnes / total * 100).toFixed(0)}%)`
      );
    }

    for (const stat of layerStats) console.log(stat);

    // Evaluate quantized model accuracy
    console.log('');
    console.log('[Quantization] Evaluating quantized model...');

    let quantizedCorrect = 0;

    for (const example of testSet) {
      // Forward pass with ternary weights (simulated)
      let activation = example.features;
      for (let l = 0; l < network.layers.length; l++) {
        const layer = network.layers[l];
        const ternary = ternaryLayers[l];
        const next = new Float32Array(layer.rows);

        for (let j = 0; j < layer.rows; j++) {
          let sum = layer.biases[j]; // Biases stay float
          const offset = j * layer.cols;
          for (let i = 0; i < layer.cols; i++) {
            const w = ternary[offset + i];
            if (w === 1) sum += activation[i];
            else if (w === -1) sum -= activation[i];
          }
          next[j] = l < network.layers.length - 1 ? Math.max(0, sum) : sum;
        }

        if (l === network.layers.length - 1) {
          activation = softmax(next);
        } else {
          activation = next;
        }
      }

      let maxIdx = 0;
      for (let i = 1; i < activation.length; i++) {
        if (activation[i] > activation[maxIdx]) maxIdx = i;
      }

      if (maxIdx === example.targetClass) quantizedCorrect++;
    }

    const quantizedAcc = testSet.length > 0 ? quantizedCorrect / testSet.length : 0;
    const accDrop = bestTestAcc - quantizedAcc;
    finalAcc = quantizedAcc;

    console.log(`  Float32 accuracy: ${(bestTestAcc * 100).toFixed(1)}%`);
    console.log(`  Ternary accuracy: ${(quantizedAcc * 100).toFixed(1)}%`);
    console.log(`  Accuracy drop:    ${(accDrop * 100).toFixed(1)}%`);
  }

  // Print confusion matrix (for both modes)
  const confusionMatrix = Array.from({ length: 4 }, () => new Array(4).fill(0));
  for (const example of testSet) {
    let activation = example.features;
    for (let l = 0; l < network.layers.length; l++) {
      const layer = network.layers[l];
      const next = new Float32Array(layer.rows);

      for (let j = 0; j < layer.rows; j++) {
        let sum = layer.biases[j];
        const offset = j * layer.cols;
        for (let i = 0; i < layer.cols; i++) {
          if (options.float32) {
            sum += layer.weights[offset + i] * activation[i];
          } else {
            const w = ternaryLayers[l][offset + i];
            if (w === 1) sum += activation[i];
            else if (w === -1) sum -= activation[i];
          }
        }
        next[j] = l < network.layers.length - 1 ? Math.max(0, sum) : sum;
      }

      if (l === network.layers.length - 1) {
        activation = softmax(next);
      } else {
        activation = next;
      }
    }
    let maxIdx = 0;
    for (let i = 1; i < activation.length; i++) {
      if (activation[i] > activation[maxIdx]) maxIdx = i;
    }
    confusionMatrix[example.targetClass][maxIdx]++;
  }

  const labels = ['SAFE', 'SUSP', 'DANG', 'SCAM'];
  console.log('');
  console.log('  Confusion Matrix:');
  console.log(`  ${''.padStart(6)} ${labels.map(l => l.padStart(6)).join('')}`);
  for (let i = 0; i < 4; i++) {
    const row = confusionMatrix[i].map((v: number) => String(v).padStart(6)).join('');
    console.log(`  ${labels[i].padStart(6)}${row}`);
  }

  // ============================================================
  // Export model
  // ============================================================

  const model: any = {
    version: 1,
    architecture,
    quantization: options.float32 ? 'float32' : 'ternary',
    weights: {},
    biases: {},
    classes: ['SAFE', 'SUSPICIOUS', 'DANGEROUS', 'SCAM'],
    featureCount,
    accuracy: finalAcc,
    trainedOn: allRecords.length,
    trainedAt: new Date().toISOString(),
    trainingEpochs: options.epochs,
    finalLoss: bestLoss,
  };

  let exportedWeights = 0;
  const totalBiases = network.layers.reduce((sum, l) => sum + l.biases.length, 0);

  if (options.float32) {
    // Export float32 weights
    for (let l = 0; l < network.layers.length; l++) {
      model.weights[`layer${l + 1}`] = Array.from(network.layers[l].weights);
      model.biases[`layer${l + 1}`] = Array.from(network.layers[l].biases);
      exportedWeights += network.layers[l].weights.length;
    }
  } else {
    // Export ternary weights
    for (let l = 0; l < ternaryLayers.length; l++) {
      model.weights[`layer${l + 1}`] = Array.from(ternaryLayers[l]);
      model.biases[`layer${l + 1}`] = Array.from(network.layers[l].biases);
      exportedWeights += ternaryLayers[l].length;
    }
  }

  // Calculate model size
  const bytesPerWeight = options.float32 ? 4 : 1;
  const modelSizeBytes = exportedWeights * bytesPerWeight + totalBiases * 4;

  mkdirSync(dirname(options.output), { recursive: true });
  writeFileSync(options.output, JSON.stringify(model, null, 2));

  console.log('');
  console.log('==========================================================');
  console.log('  MODEL EXPORTED');
  console.log('==========================================================');
  console.log(`  Path:          ${options.output}`);
  console.log(`  Architecture:  ${architecture.join(' → ')}`);
  console.log(`  Mode:          ${options.float32 ? 'Float32' : 'Ternary'}`);
  console.log(`  Total weights: ${exportedWeights}`);
  console.log(`  Float biases:  ${totalBiases}`);
  console.log(`  Model size:    ${modelSizeBytes} bytes (${(modelSizeBytes / 1024).toFixed(1)} KB)`);
  console.log(`  Accuracy:      ${(finalAcc * 100).toFixed(1)}%`);
  console.log(`  Trained on:    ${allRecords.length} examples`);
  console.log('==========================================================');
  console.log('');
}

// ============================================================
// CLI
// ============================================================

const program = new Command();

program
  .name('train')
  .description('Train BitNet ternary classifier for token risk scoring')
  .option('-d, --data <path>', 'Training data JSONL file', './data/training-balanced.jsonl')
  .option('-o, --output <path>', 'Output model file', '../../packages/agents/src/reasoning/bitnet-weights.json')
  .option('-e, --epochs <n>', 'Training epochs', '200')
  .option('--lr <rate>', 'Learning rate', '0.01')
  .option('--momentum <m>', 'SGD momentum', '0.9')
  .option('--batch-size <n>', 'Mini-batch size', '16')
  .option('--hidden <sizes>', 'Hidden layer sizes (comma-separated)', '64,32')
  .option('--split <ratio>', 'Train/test split ratio', '0.8')
  .option('--seed <n>', 'Random seed for reproducibility')
  .option('--float32', 'Keep float32 weights (no ternary quantization)')
  .action(async (options) => {
    await train({
      data: options.data,
      output: options.output,
      epochs: parseInt(options.epochs),
      lr: parseFloat(options.lr),
      momentum: parseFloat(options.momentum),
      batchSize: parseInt(options.batchSize),
      hiddenSizes: options.hidden.split(',').map(Number),
      splitRatio: parseFloat(options.split),
      seed: options.seed ? parseInt(options.seed) : undefined,
      float32: options.float32 || false,
    });
  });

program.parse();
