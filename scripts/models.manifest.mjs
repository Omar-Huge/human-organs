/**
 * Model provenance.
 *
 * Source: BodyParts3D, The Database Center for Life Science.
 * Licence: CC-BY 4.0 — attribution only, no share-alike. Note that Wikipedia, the
 * third-party GitHub mirror and pre-4.0 pages all state CC-BY-SA 2.1 Japan; the current
 * licence page and the v4.0 README both state CC-BY 4.0. Verified on both, because a
 * share-alike obligation would propagate into this repository.
 *
 * `concepts` are the FMA ids whose element meshes make up the organ — paired organs list
 * two. `hotspots` name sub-structures that are exact subsets of those elements; each
 * becomes a named node in the GLB and a derived hotspot in the UI.
 */

export const ATLAS_BASE = 'https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST';
export const ATLAS_ZIP_URL = `${ATLAS_BASE}/partof_BP3D_4.0_obj_99.zip`;
export const CONCEPT_LIST_URL = `${ATLAS_BASE}/partof_parts_list_e.txt`;
export const ELEMENT_MAP_URL = `${ATLAS_BASE}/partof_element_parts.txt`;
export const LICENCE_URL = 'https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html';
export const ATTRIBUTION =
  'BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International';

/** Directory inside the zip. */
export const ZIP_PREFIX = 'partof_BP3D_4.0_obj_99/';

export const MODELS = [
  {
    id: 'heart',
    title: 'Heart',
    concepts: ['FMA7088'],
    // No valves here. A valve sits at the boundary between two chambers, and this atlas's
    // mesh decomposition assigns those boundary faces to both neighbouring chambers rather
    // than to the valve alone — so a valve's meshes are *entirely* shared with the chambers
    // it sits between, leaving it nothing of its own once the chambers (listed first) have
    // claimed their share. That's an empty hotspot, not just an overlapping one, so it's
    // left out.
    //
    // The four chambers below stay in, even though each pair sharing a valve ring also
    // shares that ring's meshes directly (right-atrium/right-ventricle share the tricuspid
    // ring, left-atrium/left-ventricle share the mitral ring) — merely sharing a boundary
    // with a neighbour is normal for adjacent anatomy and doesn't empty either side. The
    // build assigns a shared mesh to whichever chamber is listed first here.
    hotspots: [
      { id: 'right-atrium', fmaId: 'FMA7096' },
      { id: 'left-atrium', fmaId: 'FMA7097' },
      { id: 'right-ventricle', fmaId: 'FMA7098' },
      { id: 'left-ventricle', fmaId: 'FMA7101' },
      { id: 'right-coronary-artery', fmaId: 'FMA50039' },
      { id: 'left-coronary-artery', fmaId: 'FMA50040' },
    ],
    simplifyRatio: 0,
  },
  {
    id: 'brain',
    title: 'Brain',
    concepts: ['FMA50801'],
    // Ordered smaller/more specific first so the tie-break doesn't starve them: brainstem
    // and diencephalon are small midline structures that the much larger hemispheres could
    // otherwise swallow if listed after them.
    hotspots: [
      { id: 'brainstem', fmaId: 'FMA79876' },
      { id: 'diencephalon', fmaId: 'FMA62001' },
      { id: 'right-cerebral-hemisphere', fmaId: 'FMA67292' },
      { id: 'left-cerebral-hemisphere', fmaId: 'FMA61819' },
      { id: 'cerebellum', fmaId: 'FMA67944' },
    ],
    simplifyRatio: 0,
  },
  {
    id: 'lungs',
    title: 'Lungs',
    concepts: ['FMA7309', 'FMA7310'],
    // The atlas's lungs are only airway and vessel trees — no outer surface in either
    // the part-of or is-a edition. build-organs wraps each lobe's trees in a generated
    // sheet; radius is in mm, about half the spacing of neighbouring branches.
    envelope: { radius: 12, resolution: 80, blur: 2, isolation: 0.45 },
    // A complete anatomical partition — these five lobes sum to all 280 elements in the
    // organ, so there's no `rest` group here and order among them doesn't affect the
    // outcome (lobes don't overlap each other in this atlas).
    hotspots: [
      { id: 'upper-lobe-right', fmaId: 'FMA7333' },
      { id: 'middle-lobe-right', fmaId: 'FMA7383' },
      { id: 'lower-lobe-right', fmaId: 'FMA7337' },
      { id: 'upper-lobe-left', fmaId: 'FMA7370' },
      { id: 'lower-lobe-left', fmaId: 'FMA7371' },
    ],
    simplifyRatio: 0,
  },
  {
    id: 'liver',
    title: 'Liver',
    concepts: ['FMA7197'],
    // The biliary tree threads through both lobes, so it's listed first to claim its shared
    // elements before the lobes do.
    hotspots: [
      { id: 'intrahepatic-biliary-tree', fmaId: 'FMA68016' },
      { id: 'left-lobe', fmaId: 'FMA13363' },
      { id: 'right-lobe', fmaId: 'FMA13362' },
      { id: 'right-portal-vein', fmaId: 'FMA15414' },
    ],
    simplifyRatio: 0,
  },
  {
    id: 'kidneys',
    title: 'Kidneys',
    concepts: ['FMA7204', 'FMA7205'],
    // These hotspots are the organ's own two `concepts`, not sub-structures of it — legal
    // because groupElements only requires a hotspot's elements to be a subset of the
    // organ's combined element set, which each single kidney trivially is. The entity here
    // is "kidneys" as a pair, with no finer decomposition available (0 sub-structures per
    // docs/substructures.txt), so splitting it into left/right is the only way isolate has
    // anything to act on for this organ.
    hotspots: [
      { id: 'right-kidney', fmaId: 'FMA7204' },
      { id: 'left-kidney', fmaId: 'FMA7205' },
    ],
    simplifyRatio: 0,
  },
  {
    id: 'eyeball',
    title: 'Eyeball',
    concepts: ['FMA12514'],
    hotspots: [
      { id: 'cornea', fmaId: 'FMA58239' },
      { id: 'iris', fmaId: 'FMA58236' },
      { id: 'lens', fmaId: 'FMA58242' },
      { id: 'sclera', fmaId: 'FMA58271' },
      { id: 'vitreous-body', fmaId: 'FMA58828' },
      { id: 'choroid', fmaId: 'FMA58299' },
    ],
    simplifyRatio: 0,
  },
  {
    id: 'intestine',
    title: 'Intestine',
    concepts: ['FMA7200', 'FMA7201'],
    // duodenum and ileocecal-junction are single-element structures sitting right at the
    // organ's boundaries, listed first so the much larger jejunum/ileum entries can't
    // absorb them before they get a chance to claim their own element.
    hotspots: [
      { id: 'duodenum', fmaId: 'FMA7206' },
      { id: 'ileocecal-junction', fmaId: 'FMA11338' },
      { id: 'jejunum', fmaId: 'FMA7207' },
      { id: 'ileum', fmaId: 'FMA7208' },
      // The atlas's intestine includes the colon; labelling it keeps it from reading as
      // part of the small intestine.
      { id: 'large-intestine', fmaId: 'FMA7201' },
    ],
    simplifyRatio: 0,
  },
  {
    id: 'pancreas',
    title: 'Pancreas',
    concepts: ['FMA7198'],
    hotspots: [
      { id: 'pancreatic-duct-tree', fmaId: 'FMA63103' },
      { id: 'parenchyma', fmaId: 'FMA63120' },
    ],
    simplifyRatio: 0,
  },
  {
    id: 'skin',
    title: 'Skin',
    concepts: ['FMA7163'],
    // No hotspots: skin is a single undifferentiated surface mesh in this atlas (1 element,
    // no sub-structures per docs/substructures.txt), so there's nothing to derive isolate
    // groups from here. A later task adds hand-authored markers instead.
    hotspots: [],
    // One whole-body surface mesh and the likeliest to miss the budget. It carries no
    // sub-structure, so geometry is the only lever available here.
    simplifyRatio: 0,
  },
];

/** Per-model ceiling, and the total across all models. */
export const PER_MODEL_BUDGET = 1.5 * 1024 * 1024;
export const TOTAL_BUDGET = 12 * 1024 * 1024;

/** Default maximum texture dimension; a model may override it. */
export const TEXTURE_SIZE = 1024;
