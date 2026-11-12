// The only brain/behaviour science Creative Check may cite (PRD CC-07). The model attaches ids;
// it never writes its own neuroscience. Unknown ids are dropped by validate.ts.
// `science`: how solid the finding is in general. `adLink`: how well it's shown to matter for ads/social.

export type Grade = 'Established' | 'Supported' | 'Emerging' | 'Speculative';

export interface Mechanism {
  id: string;
  name: string;
  /** What in the content brings it up. */
  cue: string;
  /** Plain-language explanation for the creator. */
  pattern: string;
  science: Grade;
  scienceNote?: string;
  adLink: Grade;
  source: string;
}

export const MECHANISMS: readonly Mechanism[] = [
  { id: 'face_attention', name: 'Faces draw the eye', cue: 'A human face visible early',
    pattern: 'People look at faces first and fast, often before anything else in a frame.',
    science: 'Established', adLink: 'Supported',
    source: 'Cerf, Harel, Einhäuser & Koch 2008, "Predicting human gaze using low-level saliency combined with face detection" (NIPS); Kanwisher, McDermott & Chun 1997, "The fusiform face area", J. Neuroscience' },
  { id: 'visual_saliency', name: 'Contrast pops', cue: 'High contrast or a colour pop on the key element',
    pattern: 'Elements that differ sharply in colour, brightness or orientation from their surroundings get looked at sooner.',
    science: 'Established', adLink: 'Supported',
    source: 'Itti, Koch & Niebur 1998, "A model of saliency-based visual attention for rapid scene analysis", IEEE TPAMI' },
  { id: 'motion_onset', name: 'Movement grabs attention', cue: 'Movement or a cut at the start',
    pattern: 'Something starting to move captures attention automatically, more than steady motion does.',
    science: 'Established', adLink: 'Supported',
    source: 'Abrams & Christ 2003, "Motion onset captures attention", Psychological Science' },
  { id: 'cognitive_load', name: 'Too much at once', cue: 'Lots of on-screen text while someone is speaking',
    pattern: 'Reading and listening to different words at the same time competes for the same limited capacity; people take in less of both.',
    science: 'Established', adLink: 'Supported',
    source: 'Sweller 1988, "Cognitive load during problem solving", Cognitive Science; Mayer 2009, "Multimedia Learning" (2nd ed., redundancy principle)' },
  { id: 'processing_fluency', name: 'Easy feels true', cue: 'Simple words, clean layout',
    pattern: 'Content that is easy to read and see tends to be liked and trusted more.',
    science: 'Supported', adLink: 'Supported',
    source: 'Reber, Schwarz & Winkielman 2004, "Processing fluency and aesthetic pleasure", Personality and Social Psychology Review' },
  { id: 'information_gap', name: 'Curiosity gap', cue: 'A question or open loop in the hook',
    pattern: 'Pointing at a gap in what someone knows makes them want to close it.',
    science: 'Supported', adLink: 'Emerging',
    source: 'Loewenstein 1994, "The psychology of curiosity", Psychological Bulletin; Kang et al. 2009, "The wick in the candle of learning", Psychological Science' },
  { id: 'picture_superiority', name: 'Pictures stick', cue: 'The key idea shown as an image, not only said',
    pattern: 'Ideas shown as pictures are remembered better than the same ideas as words alone.',
    science: 'Established', adLink: 'Supported',
    source: 'Paivio 1971, "Imagery and Verbal Processes"' },
  { id: 'emotional_memory', name: 'Feeling helps memory', cue: 'An emotional moment tied to the message',
    pattern: 'Emotionally arousing moments are remembered better, and so is what is tied to them.',
    science: 'Established', adLink: 'Supported',
    source: 'McGaugh 2004, "The amygdala modulates the consolidation of memories of emotionally arousing experiences", Annual Review of Neuroscience' },
  { id: 'isolation_effect', name: 'The odd one out', cue: 'One element made to stand out',
    pattern: 'An item that differs from everything around it is noticed and remembered better.',
    science: 'Established', adLink: 'Supported',
    source: 'von Restorff 1933, "Über die Wirkung von Bereichsbildungen im Spurenfeld", Psychologische Forschung' },
  { id: 'serial_position', name: 'First and last stick', cue: 'The key point placed first or last',
    pattern: 'People remember the start and the end of a sequence best; the middle fades.',
    science: 'Established', adLink: 'Supported',
    source: 'Murdock 1962, "The serial position effect of free recall", J. Experimental Psychology' },
  { id: 'mere_exposure', name: 'Familiar feels good', cue: 'A brand or message repeated',
    pattern: 'Seeing something repeatedly tends to make people like it a little more, up to a point.',
    science: 'Established', adLink: 'Supported',
    source: 'Zajonc 1968, "Attitudinal effects of mere exposure", JPSP; Bornstein 1989, "Exposure and affect: overview and meta-analysis", Psychological Bulletin' },
  { id: 'narrative_transport', name: 'Stories pull people in', cue: 'A story with a character and stakes',
    pattern: 'People absorbed in a story argue against its message less.',
    science: 'Supported', adLink: 'Supported',
    source: 'Green & Brock 2000, "The role of transportation in the persuasiveness of public narratives", JPSP' },
  { id: 'loss_aversion', name: 'Losses loom larger', cue: 'Framed as a loss or a cost',
    pattern: 'A loss often weighs more than a gain of the same size, though how much depends on the situation.',
    science: 'Supported', scienceNote: 'debated', adLink: 'Supported',
    source: 'Kahneman & Tversky 1979, "Prospect theory", Econometrica; Gal & Rucker 2018, "The loss of loss aversion", J. Consumer Psychology' },
  { id: 'choice_overload', name: 'Too many options', cue: 'Several CTAs or options at once',
    pattern: 'More options can make people choose nothing, but the effect is inconsistent across studies.',
    science: 'Emerging', scienceNote: 'mixed', adLink: 'Emerging',
    source: 'Iyengar & Lepper 2000, "When choice is demotivating", JPSP; Scheibehenne, Greifeneder & Todd 2010, "Can there ever be too many options?", J. Consumer Research' },
  { id: 'reward_anticipation', name: 'Waiting for the payoff', cue: 'A promise of a payoff later in the video',
    pattern: 'Expecting a reward engages motivation in the lab; whether this keeps people watching social video is not shown.',
    science: 'Established', scienceNote: 'fMRI, money rewards', adLink: 'Speculative',
    source: 'Knutson, Adams, Fong & Hommer 2001, "Anticipation of increasing monetary reward selectively recruits nucleus accumbens", J. Neuroscience' },
  { id: 'zeigarnik', name: 'Unfinished business', cue: 'An unfinished task or cliffhanger',
    pattern: 'The classic claim that unfinished tasks are remembered better does not replicate reliably; people do tend to return to interrupted tasks.',
    science: 'Emerging', scienceNote: 'weak replication', adLink: 'Speculative',
    source: 'Zeigarnik 1927, Psychologische Forschung; Ghibellini & Meier 2025, "Interruption, recall and resumption: a meta-analysis of the Zeigarnik and Ovsiankina effects", Humanities and Social Sciences Communications' },
];

export const MECHANISM_IDS = new Set(MECHANISMS.map((m) => m.id));
