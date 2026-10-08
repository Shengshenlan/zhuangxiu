export function summarizeBudget(rows) {
  const phases = [0, 0, 0];
  for (const row of rows) if (row.included) phases[row.phase - 1] += Number(row.planning);
  const contingency = Math.ceil((phases[0] + phases[1]) * .10 / 100) * 100;
  return { phases, contingency, hardFund: phases[0] + contingency, beforeMove: phases[0] + phases[1] + contingency,
    total: phases.reduce((a, b) => a + b, 0) + contingency };
}
