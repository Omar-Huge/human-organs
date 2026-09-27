/**
 * Soft Machinery — content model.
 *
 * Single source of truth for every string the UI renders. No content lives in JSX.
 *
 * COORDINATE SPACE
 * Hotspot `position` values (authored hotspots only — see below) are in *normalised
 * model space*: every model is centred on its bounding-box origin and uniformly scaled
 * to fit a cube of edge length `MODEL_FIT_SIZE` (see `app/lib/three/loaders.ts`) at load
 * time. Roughly, x/y/z each run -1..1 with the model's widest axis touching the edges.
 * Do not author against raw glTF units — they differ per model by orders of magnitude.
 *
 * DERIVED VS AUTHORED HOTSPOTS
 * Every organ but skin decomposes into named sub-structures in the BodyParts3D atlas
 * (see `scripts/models.manifest.mjs`). Those hotspots carry an `fmaId` instead of a
 * position: the build measures the centroid of that structure's actual mesh and also
 * uses the id to drive the isolate tool, so position is derived, never authored, and
 * always exactly matches the geometry. Skin is one undifferentiated surface mesh with
 * no sub-structure to derive from, so its three hotspots are hand-placed coordinates
 * instead — the only entity that needs them.
 *
 * SOURCING
 * Every entity carries at least one citation with a retrieval date. `scripts/`-run
 * content tests fail the build on an empty `sources` array. Figures quoted here are
 * transcribed from the cited page, not recalled — where a page did not state a figure,
 * the fact is omitted rather than filled in from memory.
 */

export type EntityId =
  | 'heart'
  | 'brain'
  | 'lungs'
  | 'liver'
  | 'kidneys'
  | 'eyeball'
  | 'intestine'
  | 'pancreas'
  | 'skin';

type HotspotBase = {
  id: string;
  label: string;
  /** One line, under 60 characters. Describes the structure, not a sourced statistic. */
  detail: string;
  color: string;
};

/** Position and isolate group both come from the mesh: `fmaId` names element meshes
    that are a subset of the organ's, so the centroid is measured, not guessed. */
export type DerivedHotspot = HotspotBase & { kind: 'derived'; fmaId: string };

/** A hand-placed coordinate, used only where the atlas offers no distinct geometry.
    Normalised model space; see file header. Carries no isolate control. */
export type AuthoredHotspot = HotspotBase & { kind: 'authored'; position: [number, number, number] };

export type Hotspot = DerivedHotspot | AuthoredHotspot;

export type Fact = { label: string; value: string };

export type Source = { title: string; url: string; retrieved: string };

export type Entity = {
  id: EntityId;
  name: string;
  formalName: string;
  category: string;
  /** Path under /public. */
  model: string;
  /** Hex, drives hotspot colour and the UI accent while this entity is selected. */
  accent: string;
  summary: string;
  facts: Fact[];
  notes: string[];
  hotspots: Hotspot[];
  sources: Source[];
  hasIllustrations: boolean;
};

const RETRIEVED = '2026-08-10';

export const ENTITIES: Entity[] = [
  {
    id: 'heart',
    name: 'Heart',
    formalName: 'Heart (Cor)',
    category: 'Muscular pump',
    model: '/models/heart.glb',
    accent: '#d63d4a',
    summary:
      'A fist-sized muscle that beats without rest for a lifetime, pushing blood through two separate loops — one to the lungs, one to the rest of the body.',
    facts: [
      { label: 'Weight', value: 'About 10 oz (average adult)' },
      { label: 'Chambers', value: '4 — two atria, two ventricles' },
      { label: 'Size', value: 'About the size of a fist' },
      { label: 'Location', value: 'Front of chest, behind and left of the sternum' },
    ],
    notes: [
      'The heart sits between the two lungs rather than centred in the chest, which is why the apex beat is felt slightly left of the sternum.',
      'A muscular wall, the septum, separates the left and right sides so oxygen-poor and oxygen-rich blood never mix.',
    ],
    hotspots: [
      { id: 'right-atrium', kind: 'derived', fmaId: 'FMA7096', label: 'Right atrium', detail: 'Receives deoxygenated blood returning from the body', color: '#d63d4a' },
      { id: 'left-atrium', kind: 'derived', fmaId: 'FMA7097', label: 'Left atrium', detail: 'Receives oxygenated blood arriving from the lungs', color: '#d63d4a' },
      { id: 'right-ventricle', kind: 'derived', fmaId: 'FMA7098', label: 'Right ventricle', detail: 'Pumps blood onward to the lungs for oxygen', color: '#d63d4a' },
      { id: 'left-ventricle', kind: 'derived', fmaId: 'FMA7101', label: 'Left ventricle', detail: "The heart's strongest chamber, pumps blood to the body", color: '#d63d4a' },
      { id: 'right-coronary-artery', kind: 'derived', fmaId: 'FMA50039', label: 'Right coronary artery', detail: 'Supplies the right heart and the back of the septum', color: '#d63d4a' },
      { id: 'left-coronary-artery', kind: 'derived', fmaId: 'FMA50040', label: 'Left coronary artery', detail: "Feeds most of the left ventricle's muscle", color: '#d63d4a' },
    ],
    sources: [
      {
        title: 'Heart: Anatomy & Function — Cleveland Clinic',
        url: 'https://my.clevelandclinic.org/health/body/21704-heart',
        retrieved: RETRIEVED,
      },
    ],
    hasIllustrations: false,
  },

  {
    id: 'brain',
    name: 'Brain',
    formalName: 'Brain (Cerebrum, Encephalon)',
    category: 'Central nervous organ',
    model: '/models/brain.glb',
    accent: '#8d5dd0',
    summary:
      'Roughly two per cent of body weight, the brain runs on a disproportionate share of the body’s blood and oxygen supply, coordinating everything from reflexes to thought.',
    facts: [
      { label: 'Neurons', value: 'More than 100 billion' },
      { label: 'Share of body weight', value: '2%' },
      { label: 'Share of cardiac output', value: '15%' },
      { label: 'Share of body oxygen use', value: '20%' },
      { label: 'Astrocyte share of brain volume', value: '25%' },
    ],
    notes: [
      'The brain is organised into three broad divisions — cerebrum, cerebellum, and brainstem — each visible as a distinct mass in the atlas mesh.',
      'By around age five, total brain volume is already close to its adult size, even though internal maturation continues for another two decades.',
    ],
    hotspots: [
      { id: 'brainstem', kind: 'derived', fmaId: 'FMA79876', label: 'Brainstem', detail: 'Connects the brain to the spinal cord', color: '#8d5dd0' },
      { id: 'diencephalon', kind: 'derived', fmaId: 'FMA62001', label: 'Diencephalon', detail: 'Includes the thalamus and hypothalamus', color: '#8d5dd0' },
      { id: 'right-cerebral-hemisphere', kind: 'derived', fmaId: 'FMA67292', label: 'Right cerebral hemisphere', detail: "One half of the brain's outer folded mass", color: '#8d5dd0' },
      { id: 'left-cerebral-hemisphere', kind: 'derived', fmaId: 'FMA61819', label: 'Left cerebral hemisphere', detail: "One half of the brain's outer folded mass", color: '#8d5dd0' },
      { id: 'cerebellum', kind: 'derived', fmaId: 'FMA67944', label: 'Cerebellum', detail: 'Coordinates balance, posture and fine movement', color: '#8d5dd0' },
    ],
    sources: [
      {
        title: 'Physiology, Brain — StatPearls (NCBI Bookshelf)',
        url: 'https://www.ncbi.nlm.nih.gov/books/NBK551718/',
        retrieved: RETRIEVED,
      },
    ],
    hasIllustrations: false,
  },

  {
    id: 'lungs',
    name: 'Lungs',
    formalName: 'Lungs (Pulmones)',
    category: 'Respiratory organ, paired',
    model: '/models/lungs.glb',
    accent: '#0b847a',
    summary:
      'A pair of asymmetric organs — three lobes on the right, two on the left to make room for the heart — that exchange oxygen and carbon dioxide with every breath.',
    facts: [
      { label: 'Weight', value: 'About 2.2 lb (1 kg) per lung' },
      { label: 'Length', value: '~9 in (24 cm) resting, ~10.5 in (27 cm) fully expanded' },
      { label: 'Right lung lobes', value: '3 — superior, middle, inferior' },
      { label: 'Left lung lobes', value: '2 — superior, inferior' },
      { label: 'Breathing rate', value: '12 to 20 breaths per minute' },
    ],
    notes: [
      'The left lung’s superior lobe carries a notch, the cardiac notch, shaped to leave space for the heart — the anatomical reason the two lungs are not mirror images.',
      'Fissures separate each lung into its lobes, and those same seams are what let the atlas mesh be split lobe by lobe.',
    ],
    hotspots: [
      { id: 'upper-lobe-right', kind: 'derived', fmaId: 'FMA7333', label: 'Right upper lobe', detail: 'Topmost section of the three-lobed right lung', color: '#0b847a' },
      { id: 'middle-lobe-right', kind: 'derived', fmaId: 'FMA7383', label: 'Right middle lobe', detail: 'Smallest lobe, unique to the right lung', color: '#0b847a' },
      { id: 'lower-lobe-right', kind: 'derived', fmaId: 'FMA7337', label: 'Right lower lobe', detail: 'Largest lobe of the right lung', color: '#0b847a' },
      { id: 'upper-lobe-left', kind: 'derived', fmaId: 'FMA7370', label: 'Left upper lobe', detail: 'Carries a notch shaped to make room for the heart', color: '#0b847a' },
      { id: 'lower-lobe-left', kind: 'derived', fmaId: 'FMA7371', label: 'Left lower lobe', detail: "Larger of the left lung's two lobes", color: '#0b847a' },
    ],
    sources: [
      {
        title: 'Lungs: Location, Anatomy, Function & Complications — Cleveland Clinic',
        url: 'https://my.clevelandclinic.org/health/body/8960-lungs',
        retrieved: RETRIEVED,
      },
    ],
    hasIllustrations: false,
  },

  {
    id: 'liver',
    name: 'Liver',
    formalName: 'Liver (Hepar)',
    category: 'Digestive gland',
    model: '/models/liver.glb',
    accent: '#aa6441',
    summary:
      'A football-sized filter that processes hundreds of gallons of blood a day, clearing toxins and producing the bile and proteins the rest of digestion depends on.',
    facts: [
      { label: 'Weight', value: '3 to 5 lb' },
      { label: 'Size', value: 'About the size and shape of a football' },
      { label: 'Lobes', value: '2 — right lobe slightly larger than left' },
      { label: 'Blood filtered', value: 'More than 250 gallons per day' },
      { label: 'Functions performed', value: 'More than 500' },
    ],
    notes: [
      'Despite being described as two lobes, the liver’s internal plumbing does not respect that boundary cleanly — its biliary ducts run through both lobes rather than staying confined to one.',
      'The liver is described as a spongy, reddish-brown wedge, coloured by the dense network of blood vessels running through it.',
    ],
    hotspots: [
      { id: 'intrahepatic-biliary-tree', kind: 'derived', fmaId: 'FMA68016', label: 'Intrahepatic biliary tree', detail: 'Ducts that carry bile out of the liver', color: '#aa6441' },
      { id: 'left-lobe', kind: 'derived', fmaId: 'FMA13363', label: 'Left lobe', detail: "Smaller of the liver's two lobes", color: '#aa6441' },
      { id: 'right-lobe', kind: 'derived', fmaId: 'FMA13362', label: 'Right lobe', detail: "Larger of the liver's two lobes", color: '#aa6441' },
      { id: 'right-portal-vein', kind: 'derived', fmaId: 'FMA15414', label: 'Right portal vein', detail: 'Carries blood from the gut into the right liver', color: '#aa6441' },
    ],
    sources: [
      {
        title: 'Liver: Where It’s Located, Function & Anatomy — Cleveland Clinic',
        url: 'https://my.clevelandclinic.org/health/body/21481-liver',
        retrieved: RETRIEVED,
      },
    ],
    hasIllustrations: false,
  },

  {
    id: 'kidneys',
    name: 'Kidneys',
    formalName: 'Kidneys (Renes)',
    category: 'Excretory organ, paired',
    model: '/models/kidneys.glb',
    accent: '#078847',
    summary:
      'Two fist-sized organs, one either side of the spine, that filter the entire blood supply many times over each day to remove waste and balance fluid and electrolytes.',
    facts: [
      { label: 'Size', value: 'About 4 to 5 in long, about the size of a fist' },
      { label: 'Mean weight (living-donor study)', value: '172.3 g ± 32.7 g' },
      { label: 'Fluid filtered', value: 'About 200 quarts per day' },
      { label: 'Blood filtered', value: 'About half a cup per minute' },
      { label: 'Location', value: 'Below the rib cage, one on either side of the spine' },
    ],
    notes: [
      'This atlas has no finer sub-structure for a single kidney to decompose into, so the two hotspots here are the left and right kidney themselves rather than internal parts.',
      'The kidneys sit retroperitoneally, behind the lining of the abdominal cavity rather than inside it, which is part of why their position is so consistent from body to body.',
    ],
    hotspots: [
      { id: 'right-kidney', kind: 'derived', fmaId: 'FMA7204', label: 'Right kidney', detail: 'Sits slightly lower than the left, below the liver', color: '#078847' },
      { id: 'left-kidney', kind: 'derived', fmaId: 'FMA7205', label: 'Left kidney', detail: 'Sits slightly higher than the right, below the spleen', color: '#078847' },
    ],
    sources: [
      {
        title: 'Kidneys: Location, Anatomy, Function & Health — Cleveland Clinic',
        url: 'https://my.clevelandclinic.org/health/body/21824-kidney',
        retrieved: RETRIEVED,
      },
      {
        title: 'Kidney weight and volume among living donors in Brazil — PMC',
        url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11020548/',
        retrieved: RETRIEVED,
      },
    ],
    hasIllustrations: false,
  },

  {
    id: 'eyeball',
    name: 'Eyeball',
    formalName: 'Eyeball (Bulbus Oculi)',
    category: 'Sensory organ, paired',
    model: '/models/eyeball.glb',
    accent: '#107ac6',
    summary:
      'A fluid-filled sphere barely an inch across, built from clear, layered components that bend and focus light onto the retina at the back.',
    facts: [
      { label: 'Diameter', value: '24 to 25 mm (sagittal), 24 mm (transverse)' },
      { label: 'Volume', value: 'About 6.5 cc' },
      { label: 'Sclera thickness', value: 'About 1 mm' },
      { label: 'Vitreous share of eye volume', value: 'About 80%' },
    ],
    notes: [
      'The cornea does most of the eye’s focusing work before light ever reaches the lens, which mainly fine-tunes for near objects.',
      'The vitreous body is mostly water, but the small remainder — salts, collagen, and cells that keep the cavity clean — is enough to hold the eyeball’s shape.',
    ],
    hotspots: [
      { id: 'cornea', kind: 'derived', fmaId: 'FMA58239', label: 'Cornea', detail: "Clear dome that does most of the eye's focusing", color: '#107ac6' },
      { id: 'iris', kind: 'derived', fmaId: 'FMA58236', label: 'Iris', detail: 'Coloured ring of muscle that sizes the pupil', color: '#107ac6' },
      { id: 'lens', kind: 'derived', fmaId: 'FMA58242', label: 'Lens', detail: 'Flexes to fine-tune focus on near objects', color: '#107ac6' },
      { id: 'sclera', kind: 'derived', fmaId: 'FMA58271', label: 'Sclera', detail: 'Tough white outer wall that shapes the eyeball', color: '#107ac6' },
      { id: 'vitreous-body', kind: 'derived', fmaId: 'FMA58828', label: 'Vitreous body', detail: 'Jelly that fills the eye and holds its shape', color: '#107ac6' },
      { id: 'choroid', kind: 'derived', fmaId: 'FMA58299', label: 'Choroid', detail: 'Blood-rich layer that nourishes the retina', color: '#107ac6' },
    ],
    sources: [
      {
        title: 'Gross Anatomy of the Eye — Webvision (NCBI Bookshelf)',
        url: 'https://www.ncbi.nlm.nih.gov/books/NBK11534/',
        retrieved: RETRIEVED,
      },
      {
        title: 'Corneas: Why You Should Appreciate Your Eye’s Windshield — Cleveland Clinic',
        url: 'https://my.clevelandclinic.org/health/body/21562-cornea',
        retrieved: RETRIEVED,
      },
      {
        title: 'Sclera (White of the Eye): Definition, Anatomy & Function — Cleveland Clinic',
        url: 'https://my.clevelandclinic.org/health/body/22088-sclera',
        retrieved: RETRIEVED,
      },
      {
        title: 'Aqueous and Vitreous Humor: Anatomy, Function & Location — Cleveland Clinic',
        url: 'https://my.clevelandclinic.org/health/body/24611-aqueous-humor-vitreous-humor',
        retrieved: RETRIEVED,
      },
    ],
    hasIllustrations: false,
  },

  {
    id: 'intestine',
    name: 'Intestine',
    formalName: 'Small intestine (Intestinum Tenue)',
    category: 'Digestive tract segment',
    model: '/models/intestine.glb',
    accent: '#528321',
    summary:
      'A coiled tube several metres long, running from the stomach’s exit to the large intestine, where most digestion and nutrient absorption actually happens.',
    facts: [
      { label: 'Total length', value: '3 to 5 m' },
      { label: 'Duodenum length', value: '20 to 25 cm' },
      { label: 'Jejunum length', value: 'About 2.5 m (8 ft)' },
      { label: 'Ileum length', value: 'Around 3 m' },
      { label: 'Jejunum internal diameter', value: 'About 1 in (2.5 cm)' },
    ],
    notes: [
      'The three segments are one continuous tube with no hard boundary, but they are visibly different: the jejunum runs a deep red from its rich blood supply, while the ileum is paler and thinner-walled.',
      'The jejunum begins in the upper left of the abdomen and hands off to the ileum down in the lower right — the reverse of what the names alone would suggest.',
    ],
    hotspots: [
      { id: 'duodenum', kind: 'derived', fmaId: 'FMA7206', label: 'Duodenum', detail: 'Shortest, widest segment, just past the stomach', color: '#528321' },
      { id: 'ileocecal-junction', kind: 'derived', fmaId: 'FMA11338', label: 'Ileocecal junction', detail: 'Valve where the ileum joins the large intestine', color: '#528321' },
      { id: 'jejunum', kind: 'derived', fmaId: 'FMA7207', label: 'Jejunum', detail: 'Deep red middle segment, thick muscular wall', color: '#528321' },
      { id: 'ileum', kind: 'derived', fmaId: 'FMA7208', label: 'Ileum', detail: 'Final, thinner-walled segment before the colon', color: '#528321' },
      { id: 'large-intestine', kind: 'derived', fmaId: 'FMA7201', label: 'Large intestine', detail: 'Follows the small intestine and absorbs water', color: '#528321' },
    ],
    sources: [
      {
        title: 'Anatomy, Abdomen and Pelvis, Small Intestine — StatPearls (NCBI Bookshelf)',
        url: 'https://www.ncbi.nlm.nih.gov/books/NBK459366/',
        retrieved: RETRIEVED,
      },
      {
        title: 'Jejunum: Function, Location & What It Looks Like — Cleveland Clinic',
        url: 'https://my.clevelandclinic.org/health/body/jejunum',
        retrieved: RETRIEVED,
      },
    ],
    hasIllustrations: false,
  },

  {
    id: 'pancreas',
    name: 'Pancreas',
    formalName: 'Pancreas',
    category: 'Digestive and endocrine gland',
    model: '/models/pancreas.glb',
    accent: '#917130',
    summary:
      'A tadpole-shaped gland tucked behind the stomach that does two unrelated jobs at once: releasing digestive enzymes into the gut, and insulin and glucagon into the blood.',
    facts: [
      { label: 'Weight', value: 'About 91.8 g (0.20 lb)' },
      { label: 'Length', value: 'About 6 in' },
      { label: 'Digestive juice produced', value: '1 to 4 L per day' },
      { label: 'Location', value: 'Behind the stomach, in front of the spine' },
      { label: 'Key hormones', value: 'Insulin and glucagon' },
    ],
    notes: [
      'The pancreas’s exocrine tissue, which makes digestive enzymes, and its endocrine tissue, the hormone-producing islets of Langerhans, sit side by side but drain through entirely separate routes — one into a duct, the other straight into the bloodstream.',
      'Shaped thick at one end and thin at the other, the gland is often described as tadpole-like, with a bumpy outer texture compared to a corn cob.',
    ],
    hotspots: [
      { id: 'pancreatic-duct-tree', kind: 'derived', fmaId: 'FMA63103', label: 'Pancreatic duct tree', detail: 'Channels that carry digestive enzymes to the gut', color: '#917130' },
      { id: 'parenchyma', kind: 'derived', fmaId: 'FMA63120', label: 'Parenchyma', detail: 'Glandular tissue making enzymes and hormones', color: '#917130' },
    ],
    sources: [
      {
        title: 'Pancreas: Function, Location, Anatomy & Living Without One — Cleveland Clinic',
        url: 'https://my.clevelandclinic.org/health/body/21743-pancreas',
        retrieved: RETRIEVED,
      },
    ],
    hasIllustrations: false,
  },

  {
    id: 'skin',
    name: 'Skin',
    formalName: 'Skin (Cutis, Integument)',
    category: 'Integumentary organ',
    model: '/models/skin.glb',
    accent: '#cd379b',
    summary:
      'The body’s largest organ by area and weight, a continuous three-layer sheet that holds everything else in, keeps pathogens and water where they belong, and reads the outside world by touch.',
    facts: [
      { label: 'Surface area', value: '1.5 to 2 m²' },
      { label: 'Weight', value: '3.5 to 10 kg (7.5 to 22 lb)' },
      { label: 'Layers', value: '3 — epidermis, dermis, hypodermis' },
      { label: 'Dermis share of thickness', value: '90%' },
      { label: 'Cell renewal cycle', value: 'New epidermal cells surface within about 4 weeks' },
    ],
    notes: [
      'Unlike the other eight entities here, the atlas represents skin as a single undifferentiated surface with no internal parts to decompose — anatomically real, but not something this decomposition method can subdivide.',
      'Thickness varies enormously by location on the same sheet: a few tenths of a millimetre on the eyelids versus several millimetres on the soles of the feet.',
    ],
    // Measured off the upright model: arms hang at the sides, so the body spans only
    // about ±0.39 in x once normalised, and the hand sits just outside the hip.
    hotspots: [
      {
        id: 'scalp',
        kind: 'authored',
        label: 'Scalp',
        detail: 'Thin skin over the skull, dense with hair follicles',
        position: [0, 0.98, -0.02],
        color: '#cd379b',
      },
      {
        id: 'palm',
        kind: 'authored',
        label: 'Palm',
        detail: 'Thick, hairless skin built for grip, not warmth',
        position: [0.34, -0.11, 0.1],
        color: '#cd379b',
      },
      {
        id: 'sole',
        kind: 'authored',
        label: 'Sole',
        detail: "The body's thickest skin, made to bear its weight",
        position: [0.16, -0.99, 0.09],
        color: '#cd379b',
      },
    ],
    sources: [
      {
        title: 'Skin: Layers, Structure and Function — Cleveland Clinic',
        url: 'https://my.clevelandclinic.org/health/body/10978-skin',
        retrieved: RETRIEVED,
      },
      {
        title: 'In brief: How does skin work? — InformedHealth.org (NCBI Bookshelf)',
        url: 'https://www.ncbi.nlm.nih.gov/books/NBK279255/',
        retrieved: RETRIEVED,
      },
    ],
    hasIllustrations: false,
  },
];

export const ENTITY_IDS: EntityId[] = ENTITIES.map((entity) => entity.id);

export const DEFAULT_ENTITY_ID: EntityId = 'heart';

export function getEntity(id: EntityId): Entity {
  const entity = ENTITIES.find((candidate) => candidate.id === id);
  if (!entity) {
    throw new Error(`Unknown entity id: ${id}`);
  }
  return entity;
}
