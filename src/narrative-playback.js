export const DEMO_ROUTE = Object.freeze([
  "hongduyuan",
  "ramp",
  "shaft-sequence",
  "niches",
  "threshold",
  "chamber",
  "epitaph",
  "theft"
]);

export const ARTIFACT_SEQUENCE = Object.freeze([
  "镇墓兽",
  "镇墓武士俑",
  "墓志",
  "铜钱",
  "玻璃串珠",
  "贝壳",
  "银环",
  "铜钵",
  "骑马俑",
  "风帽俑",
  "笼冠俑",
  "女侍俑",
  "陶羊"
]);

const NICHE_ARTIFACT_NAMES = ["骑马俑", "风帽俑", "笼冠俑", "女侍俑", "陶羊"];
export const CHAMBER_AUTOPLAY_EXCLUSIONS = Object.freeze([...NICHE_ARTIFACT_NAMES]);
const chamberAutoplayExclusionSet = new Set(CHAMBER_AUTOPLAY_EXCLUSIONS);

export const NARRATIVE_ARTIFACTS = Object.freeze({
  hongduyuan: Object.freeze([]),
  ramp: Object.freeze([]),
  "shaft-sequence": Object.freeze([]),
  niches: Object.freeze(NICHE_ARTIFACT_NAMES.map(name => Object.freeze({
    name,
    locationKey: `niches:${name}`
  }))),
  threshold: Object.freeze([]),
  chamber: Object.freeze(ARTIFACT_SEQUENCE.filter(name => name !== "墓志")),
  epitaph: Object.freeze(["墓志"]),
  theft: Object.freeze([])
});

export function normalizeArtifactLink(item) {
  return typeof item === "string" ? { name: item, locationKey: "" } : {
    name: item?.name || "",
    locationKey: item?.locationKey || ""
  };
}

export function artifactLinksForEntry(entry) {
  return (entry?.artifacts || []).map(normalizeArtifactLink).filter(item => item.name);
}

export function buildNarrativePlaybackSequence(entries, route = DEMO_ROUTE) {
  const entriesById = new Map(entries.map(entry => [entry.id, entry]));
  return route.flatMap(narrativeId => {
    const entry = entriesById.get(narrativeId);
    if (!entry) return [];
    const steps = [{ type: "narrative", narrativeId }];
    artifactLinksForEntry(entry)
      .filter(link => narrativeId !== "chamber" || !chamberAutoplayExclusionSet.has(link.name))
      .forEach(link => {
        steps.push({ type: "artifact", narrativeId, ...link });
        if (narrativeId === "epitaph" && link.name === "墓志") {
          steps.push(
            { type: "epitaph-open", narrativeId },
            { type: "epitaph-close", narrativeId }
          );
        }
      });
    return steps;
  });
}

export function playbackResumeIndex(sequence, currentStep) {
  if (!currentStep?.type || !currentStep?.narrativeId) return 0;
  const index = sequence.findIndex(step => {
    if (step.type !== currentStep.type || step.narrativeId !== currentStep.narrativeId) return false;
    if (step.type !== "artifact") return true;
    return step.name === currentStep.name
      && (step.locationKey || "") === (currentStep.locationKey || "");
  });
  if (index >= 0) return index + 1;
  if (currentStep.type === "artifact" && currentStep.narrativeId === "chamber"
    && chamberAutoplayExclusionSet.has(currentStep.name)) {
    const lastChamberStep = sequence.reduce((last, step, stepIndex) => (
      step.narrativeId === "chamber" ? stepIndex : last
    ), -1);
    return lastChamberStep + 1;
  }
  return 0;
}
