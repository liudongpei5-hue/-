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
    return [
      { type: "narrative", narrativeId },
      ...artifactLinksForEntry(entry).map(link => ({ type: "artifact", narrativeId, ...link }))
    ];
  });
}
