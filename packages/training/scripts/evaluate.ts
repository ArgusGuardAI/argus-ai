#!/usr/bin/env npx tsx
/**
 * Model Evaluation Script
 *
 * Evaluates model performance against test data.
 * Can compare: AI score vs Guardrails score vs BitNet score
 *
 * Usage:
 *   ADMIN_SECRET=xxx pnpm evaluate --test-split 0.2
 */

import { Command } from 'commander';

const TRAINING_API = 'https://argusguard-api.hermosillo-jessie.workers.dev/training';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

interface TrainingExample {
  id: string;
  input: {
    token: { symbol: string };
    bundle: { detected: boolean };
  };
  aiOutput: { riskScore: number; riskLevel: string };
  finalOutput: { riskScore: number; riskLevel: string; wasOverridden: boolean };
  outcome?: { rugged: boolean };
}

interface EvaluationResult {
  // Classification metrics
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;

  // Confusion matrix
  truePositives: number;
  trueNegatives: number;
  falsePositives: number;
  falseNegatives: number;

  // Score metrics
  meanAbsoluteError: number;
  rootMeanSquaredError: number;

  // Breakdown
  examples: number;
  withOutcome: number;
}

// Fetch training data
async function fetchData(): Promise<TrainingExample[]> {
  if (!ADMIN_SECRET) {
    throw new Error('ADMIN_SECRET required');
  }

  const response = await fetch(`${TRAINING_API}/export`, {
    headers: { 'Authorization': `Bearer ${ADMIN_SECRET}` },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return await response.json() as TrainingExample[];
}

// Calculate evaluation metrics
function evaluate(
  predictions: Array<{ score: number; isRug: boolean }>,
  actuals: Array<{ score: number; isRug: boolean }>,
  threshold: number = 70
): EvaluationResult {
  let tp = 0, tn = 0, fp = 0, fn = 0;
  let maeSum = 0, mseSum = 0;

  for (let i = 0; i < predictions.length; i++) {
    const pred = predictions[i];
    const actual = actuals[i];

    // Classification (is it a rug?)
    const predRug = pred.score >= threshold;
    const actualRug = actual.isRug;

    if (predRug && actualRug) tp++;
    else if (!predRug && !actualRug) tn++;
    else if (predRug && !actualRug) fp++;
    else fn++;

    // Regression (score accuracy)
    const actualScore = actual.isRug ? 85 : 30; // Proxy: rug=85, safe=30
    maeSum += Math.abs(pred.score - actualScore);
    mseSum += Math.pow(pred.score - actualScore, 2);
  }

  const n = predictions.length || 1;
  const accuracy = (tp + tn) / n;
  const precision = tp / (tp + fp) || 0;
  const recall = tp / (tp + fn) || 0;
  const f1Score = 2 * (precision * recall) / (precision + recall) || 0;

  return {
    accuracy,
    precision,
    recall,
    f1Score,
    truePositives: tp,
    trueNegatives: tn,
    falsePositives: fp,
    falseNegatives: fn,
    meanAbsoluteError: maeSum / n,
    rootMeanSquaredError: Math.sqrt(mseSum / n),
    examples: n,
    withOutcome: predictions.length,
  };
}

// Print evaluation results
function printResults(name: string, results: EvaluationResult): void {
  console.log(`\n=== ${name} ===`);
  console.log(`Examples evaluated: ${results.examples}`);
  console.log(`\nClassification Metrics:`);
  console.log(`  Accuracy:  ${(results.accuracy * 100).toFixed(1)}%`);
  console.log(`  Precision: ${(results.precision * 100).toFixed(1)}%`);
  console.log(`  Recall:    ${(results.recall * 100).toFixed(1)}%`);
  console.log(`  F1 Score:  ${(results.f1Score * 100).toFixed(1)}%`);
  console.log(`\nConfusion Matrix:`);
  console.log(`  True Positives:  ${results.truePositives} (correctly predicted rugs)`);
  console.log(`  True Negatives:  ${results.trueNegatives} (correctly predicted safe)`);
  console.log(`  False Positives: ${results.falsePositives} (false alarms)`);
  console.log(`  False Negatives: ${results.falseNegatives} (missed rugs)`);
  console.log(`\nScore Metrics:`);
  console.log(`  MAE:  ${results.meanAbsoluteError.toFixed(1)} points`);
  console.log(`  RMSE: ${results.rootMeanSquaredError.toFixed(1)} points`);
}

// Compare different scoring methods
function compareScorers(
  examples: TrainingExample[],
  threshold: number
): void {
  // Filter to examples with known outcomes
  const withOutcome = examples.filter(e => e.outcome !== undefined);

  if (withOutcome.length === 0) {
    console.log('\nNo examples with known outcomes. Cannot evaluate.');
    console.log('Use /training/outcome to report token outcomes.');
    return;
  }

  console.log(`\nEvaluating ${withOutcome.length} examples with known outcomes`);
  console.log(`Threshold for rug classification: ${threshold}`);

  // Ground truth
  const actuals = withOutcome.map(e => ({
    score: e.outcome!.rugged ? 85 : 30,
    isRug: e.outcome!.rugged,
  }));

  // AI predictions (raw, before guardrails)
  const aiPredictions = withOutcome.map(e => ({
    score: e.aiOutput.riskScore,
    isRug: e.aiOutput.riskScore >= threshold,
  }));

  // Guardrails predictions (adjusted)
  const guardrailsPredictions = withOutcome.map(e => ({
    score: e.finalOutput.riskScore,
    isRug: e.finalOutput.riskScore >= threshold,
  }));

  // Evaluate AI
  const aiResults = evaluate(aiPredictions, actuals, threshold);
  printResults('AI ONLY (Together AI)', aiResults);

  // Evaluate Guardrails
  const guardrailsResults = evaluate(guardrailsPredictions, actuals, threshold);
  printResults('AI + GUARDRAILS', guardrailsResults);

  // Summary comparison
  console.log('\n' + '='.repeat(50));
  console.log('COMPARISON SUMMARY');
  console.log('='.repeat(50));
  console.log(`\n                   AI Only    Guardrails    Delta`);
  console.log(`  Accuracy:        ${(aiResults.accuracy * 100).toFixed(1).padStart(6)}%     ${(guardrailsResults.accuracy * 100).toFixed(1).padStart(6)}%     ${((guardrailsResults.accuracy - aiResults.accuracy) * 100).toFixed(1).padStart(5)}%`);
  console.log(`  Precision:       ${(aiResults.precision * 100).toFixed(1).padStart(6)}%     ${(guardrailsResults.precision * 100).toFixed(1).padStart(6)}%     ${((guardrailsResults.precision - aiResults.precision) * 100).toFixed(1).padStart(5)}%`);
  console.log(`  Recall:          ${(aiResults.recall * 100).toFixed(1).padStart(6)}%     ${(guardrailsResults.recall * 100).toFixed(1).padStart(6)}%     ${((guardrailsResults.recall - aiResults.recall) * 100).toFixed(1).padStart(5)}%`);
  console.log(`  Missed Rugs:     ${String(aiResults.falseNegatives).padStart(6)}      ${String(guardrailsResults.falseNegatives).padStart(6)}      ${String(guardrailsResults.falseNegatives - aiResults.falseNegatives).padStart(5)}`);
}

// Analyze override patterns
function analyzeOverrides(examples: TrainingExample[]): void {
  const overridden = examples.filter(e => e.finalOutput.wasOverridden);

  console.log('\n' + '='.repeat(50));
  console.log('GUARDRAILS OVERRIDE ANALYSIS');
  console.log('='.repeat(50));
  console.log(`\nTotal examples: ${examples.length}`);
  console.log(`Overridden: ${overridden.length} (${(overridden.length / examples.length * 100).toFixed(1)}%)`);

  // Analyze score changes
  const scoreChanges = overridden.map(e => e.finalOutput.riskScore - e.aiOutput.riskScore);
  const increased = scoreChanges.filter(c => c > 0).length;
  const decreased = scoreChanges.filter(c => c < 0).length;
  const avgChange = scoreChanges.reduce((a, b) => a + b, 0) / scoreChanges.length || 0;

  console.log(`\nOverride direction:`);
  console.log(`  Increased: ${increased} (made riskier)`);
  console.log(`  Decreased: ${decreased} (made safer)`);
  console.log(`  Average change: ${avgChange > 0 ? '+' : ''}${avgChange.toFixed(1)} points`);

  // Top override reasons
  const reasons: Record<string, number> = {};
  for (const ex of overridden) {
    // Parse reason from level change
    const aiLevel = ex.aiOutput.riskLevel;
    const finalLevel = ex.finalOutput.riskLevel;
    const reason = `${aiLevel} → ${finalLevel}`;
    reasons[reason] = (reasons[reason] || 0) + 1;
  }

  console.log(`\nOverride patterns:`);
  Object.entries(reasons)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .forEach(([reason, count]) => {
      console.log(`  ${reason}: ${count}`);
    });

  // Check if overrides were correct (if outcomes known)
  const overriddenWithOutcome = overridden.filter(e => e.outcome !== undefined);
  if (overriddenWithOutcome.length > 0) {
    const correctOverrides = overriddenWithOutcome.filter(e => {
      const finalPredRug = e.finalOutput.riskScore >= 70;
      return finalPredRug === e.outcome!.rugged;
    });

    console.log(`\nOverride accuracy (${overriddenWithOutcome.length} with known outcome):`);
    console.log(`  Correct: ${correctOverrides.length} (${(correctOverrides.length / overriddenWithOutcome.length * 100).toFixed(1)}%)`);
  }
}

// Main evaluation function
async function runEvaluation(options: {
  threshold: number;
  overrides: boolean;
}) {
  console.log('='.repeat(50));
  console.log('ARGUS AI - MODEL EVALUATION');
  console.log('='.repeat(50));

  // Fetch data
  console.log('\nFetching training data...');
  const examples = await fetchData();
  console.log(`Loaded ${examples.length} examples`);

  if (examples.length === 0) {
    console.log('\nNo training data found. Run backfill first.');
    return;
  }

  // Basic stats
  const withBundle = examples.filter(e => e.input.bundle.detected);
  const withOutcome = examples.filter(e => e.outcome !== undefined);

  console.log(`\nDataset overview:`);
  console.log(`  Total examples: ${examples.length}`);
  console.log(`  With bundles: ${withBundle.length} (${(withBundle.length / examples.length * 100).toFixed(1)}%)`);
  console.log(`  With outcomes: ${withOutcome.length} (${(withOutcome.length / examples.length * 100).toFixed(1)}%)`);

  // Compare scorers
  compareScorers(examples, options.threshold);

  // Analyze overrides
  if (options.overrides) {
    analyzeOverrides(examples);
  }

  // Recommendations
  console.log('\n' + '='.repeat(50));
  console.log('RECOMMENDATIONS');
  console.log('='.repeat(50));

  if (withOutcome.length < 50) {
    console.log(`\n1. NEED MORE OUTCOME DATA`);
    console.log(`   Only ${withOutcome.length} examples have outcomes.`);
    console.log(`   Report outcomes via POST /training/outcome`);
  }

  if (examples.length < 500) {
    console.log(`\n2. NEED MORE TRAINING DATA`);
    console.log(`   Only ${examples.length} examples total.`);
    console.log(`   Target: 1000+ for initial training, 5000+ for production`);
    console.log(`   Run: pnpm backfill --count 100`);
  }

  const overrideRate = examples.filter(e => e.finalOutput.wasOverridden).length / examples.length;
  if (overrideRate > 0.5) {
    console.log(`\n3. HIGH OVERRIDE RATE (${(overrideRate * 100).toFixed(0)}%)`);
    console.log(`   Guardrails override AI in >50% of cases.`);
    console.log(`   Consider: Is AI undertrained or are guardrails too aggressive?`);
  }
}

// CLI
const program = new Command();

program
  .name('evaluate')
  .description('Evaluate model performance')
  .option('-t, --threshold <score>', 'Score threshold for rug classification', '70')
  .option('--no-overrides', 'Skip override analysis')
  .action(async (options) => {
    await runEvaluation({
      threshold: parseInt(options.threshold),
      overrides: options.overrides !== false,
    });
  });

program.parse();
