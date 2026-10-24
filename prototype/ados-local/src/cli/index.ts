import { runDemoCommand } from "../coordinator/demos.js";
import {
  runSlice2EvidenceCorrection,
  runSlice2Fulfillment,
  runSlice2RecoveryDemo,
} from "../coordinator/slice2.js";
import { renderOwnerSummary, writeDemoEvidence } from "../evidence/artifacts.js";
import { runGate0ACardDemo } from "../gates/gate0a.js";
import { slice3aReadbackReport } from "../intake/report.js";
import { dispatchSlice3BActivation, readSlice3BStatus } from "../coordinator/slice3b.js";
import { runSlice4SafetyGate } from "../safety/slice4/coordinator.js";

const command = process.argv[2];
if (command === undefined) {
  throw new Error("COMMAND_REQUIRED");
}

try {
  if (command === "gate0a-card") {
    process.stdout.write(`${await runGate0ACardDemo()}\n`);
    process.exitCode = 0;
  } else if (command === "slice2-fulfillment") {
    const result = await runSlice2Fulfillment();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = 0;
  } else if (command === "slice2-evidence-correction") {
    const result = runSlice2EvidenceCorrection();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = 0;
  } else if (command === "slice2-recovery") {
    const result = runSlice2RecoveryDemo();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = 0;
  } else if (command === "slice3a-readback") {
    const result = await slice3aReadbackReport();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = 0;
  } else if (command === "slice3b-dispatch" || command === "slice3b-resume") {
    const activationId = process.argv[3];
    if (activationId === undefined) throw new Error("SLICE3B_ACTIVATION_ID_REQUIRED");
    const result = await dispatchSlice3BActivation(activationId, {
      force_interruption_after_session: true,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = 0;
  } else if (command === "slice3b-status") {
    const activationId = process.argv[3];
    if (activationId === undefined) throw new Error("SLICE3B_ACTIVATION_ID_REQUIRED");
    const result = await readSlice3BStatus(activationId);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = 0;
  } else if (command === "slice4-safety-card") {
    const result = await runSlice4SafetyGate();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = 0;
  } else {
    const result = await runDemoCommand(command);
    const evidencePath = writeDemoEvidence(result);
    process.stdout.write(`${renderOwnerSummary(result, evidencePath)}\n`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "UNKNOWN_FAILURE";
  process.stderr.write(`ADOS_LOCAL_COMMAND_FAILED:${message}\n`);
  process.exitCode = 1;
}
