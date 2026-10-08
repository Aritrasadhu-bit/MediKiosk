import { NextResponse } from "next/server";
import { converseRequestSchema, safeParse } from "@/lib/validation";
import { rateLimit, routeRateLimitKey } from "@/lib/server/rateLimit";
import { csrfGuard } from "@/lib/server/csrf";
import { canUseExternalModel } from "@/lib/consent";
import { bodyTooLarge, payloadTooLarge } from "@/lib/server/bodyLimit";

export const runtime = "nodejs";

const LANGUAGE_NAMES: Record<string, string> = {
  hi: "Hindi (हिन्दी)",
  bn: "Bengali (বাংলা)",
  ta: "Tamil (தமிழ்)",
  te: "Telugu (తెలుగు)",
  mr: "Marathi (मराठी)",
  gu: "Gujarati (ગુજરાતી)",
  kn: "Kannada (ಕನ್ನಡ)",
  ml: "Malayalam (മലയാളം)",
  pa: "Punjabi (ਪੰਜਾਬੀ)",
  en: "English",
};

export function getDepartmentClinicalGuidance(department?: string): string {
  const dept = (department || "").toLowerCase().trim();
  if (dept.includes("cardio") || dept.includes("heart")) {
    return "Cardiology: Focus on exertional triggers (walking/stairs vs rest), nature of chest tightness/pressure/crushing vs sharp pleuritic, radiation (jaw, neck, left arm, inner forearm, back, epigastrium), dyspnea on lying flat (orthopnea) / paroxysmal nocturnal dyspnea (PND), cold sweating, presyncope/syncope, rapid fluttering palpitations, and bilateral ankle swelling.";
  }
  if (dept.includes("neuro") || dept.includes("brain") || dept.includes("nerve")) {
    return "Neurology: Focus on focal neurological deficits (unilateral face/arm/leg weakness, numbness, tingling), speech difficulty (slurring, word-finding difficulty/aphasia), cranial nerve signs (facial droop, double vision/diplopia), headache red flags (sudden severe 'thunderclap' onset, morning vomiting, neck stiffness, photophobia), seizure semiology (tongue bite, urinary incontinence, post-ictal confusion), tremors (resting vs action), and gait/balance instability.";
  }
  if (dept.includes("pulmo") || dept.includes("chest") || dept.includes("resp") || dept.includes("lung")) {
    return "Pulmonology: Focus on cough chronicity (>2-3 weeks for TB screening), sputum volume and character (clear, purulent yellow-green, blood streaks/hemoptysis), wheezing and chest tightness, nocturnal paroxysmal breathlessness, triggers (dust, cold air, chulha/biomass smoke, allergens), fever with chills, and smoking/TB contact history.";
  }
  if (dept.includes("gastro") || dept.includes("digest") || dept.includes("stomach") || dept.includes("liver") || dept.includes("bowel")) {
    return "Gastroenterology: Focus on exact pain site (epigastric, right upper quadrant, lower abdomen) and relation to food (worse after eating/oily meals vs fasting relief/antacids), dyspepsia/acid reflux, dysphagia (swallowing difficulty for solids vs liquids), change in bowel habits (chronic diarrhea vs constipation), GI bleed (black tarry stool/melena vs fresh red blood), and jaundice signs (yellow sclera, dark urine, pale stools).";
  }
  if (dept.includes("nephro") || dept.includes("urolog") || /\buro\b/.test(dept) || dept.includes("kidney") || dept.includes("urinary")) {
    return "Nephrology & Urology: Focus on dysuria (burning micturition), frequency, nocturia, urgency, gross hematuria (reddish/tea-colored urine), frothy/foamy urine (proteinuria), oliguria (scanty urine output), early morning periorbital/facial puffiness, bilateral pedal edema, and sharp flank/loin pain radiating down to the groin (renal colic).";
  }
  if (dept.includes("endo") || dept.includes("diabet") || dept.includes("thyroid") || dept.includes("hormone")) {
    return "Endocrinology: Focus on classic osmotic symptoms (polyuria/frequent urination, polydipsia/excessive thirst, polyphagia/excessive hunger), unexplained rapid weight change (gain or loss), thermal intolerance (heat intolerance with sweating/tremors vs cold intolerance with lethargy/dry skin), anterior neck swelling/goiter, and hypoglycemic episodes (sudden shakiness, sweating, dizziness relieved by sugar).";
  }
  if (dept.includes("ortho") || dept.includes("bone") || dept.includes("joint") || dept.includes("spine")) {
    return "Orthopaedics: Focus on exact anatomical joint/bone location (knee, hip, shoulder, spine), weight-bearing ability (walking without support vs limping vs non-weight bearing), morning stiffness duration (<30 mins for osteoarthritis vs >45-60 mins for inflammatory arthritis), mechanical symptoms (true joint locking, catching, clicking, giving way/instability), trauma/fall mechanism, and radicular radiating nerve pain or numbness.";
  }
  if (dept.includes("derma") || dept.includes("skin") || dept.includes("rash")) {
    return "Dermatology: Focus on primary lesion morphology (raised red bumps/papules, water blisters/vesicles, scaly plaques, wheals/hives, pus-filled boils), pruritus/itching intensity and timing (severe nocturnal itching in scabies), anatomical distribution & spread (flexural vs extensor, sun-exposed, interdigital), mucosal/oral or nail involvement, and contact triggers (new soap, oil, cosmetic, hair dye, topical creams, medications, sun).";
  }
  if (/\bent\b/.test(dept) || dept.includes("ear") || dept.includes("nose") || dept.includes("throat") || dept.includes("otorhino")) {
    return "ENT: Focus on ear discharge (clear, foul-smelling pus, blood-stained), hearing reduction/fullness, tinnitus (ringing), spinning sensation/vertigo, throat pain on swallowing (odynophagia/dysphagia), voice hoarseness (>3 weeks duration), persistent unilateral nasal obstruction, epistaxis (nosebleeds), and facial pain/pressure over sinuses.";
  }
  if (dept.includes("ophthal") || dept.includes("eye") || dept.includes("vision")) {
    return "Ophthalmology: Focus on visual acuity changes (sudden vs gradual blurriness, loss of vision, one or both eyes), ocular pain (dull ache vs sharp surface grittiness), photophobia (light sensitivity), eye redness and nature of discharge (watery vs sticky pus), seeing colored halos around lights (acute glaucoma), and flashes of light or sudden showers of floaters.";
  }
  if (dept.includes("paed") || dept.includes("ped") || dept.includes("child") || dept.includes("infant")) {
    return "Paediatrics: Focus on child's activity and alertness level (playful and smiling vs unusually drowsy, floppy, or inconsolable), sucking vigor and feeding/fluid intake, urine frequency/number of wet diapers in last 12-24 hours, breathing effort (fast breathing, chest indrawing/subcostal retractions, grunting), fever duration and response to paracetamol, and any rash or vomiting.";
  }
  if (dept.includes("gyn") || dept.includes("obs") || dept.includes("women") || dept.includes("matern") || dept.includes("period")) {
    return "Gynaecology & Obstetrics: Focus on Last Menstrual Period (LMP) date & cycle regularity/length, flow heaviness (number of pads soaked, passage of large clots), severe cramping pelvic pain (dysmenorrhea), abnormal vaginal discharge (color, foul odor, pruritus), intermenstrual or post-coital spotting, possibility of pregnancy/missed period, and obstetric history (GPLA - pregnancies, live births, miscarriages).";
  }
  if (dept.includes("psych") || dept.includes("mental") || dept.includes("mind") || dept.includes("depress") || dept.includes("anxiet")) {
    return "Psychiatry: Focus on sleep architecture (difficulty falling asleep, broken sleep, early morning waking), persistent low mood and anhedonia (loss of interest or pleasure in daily activities), anxiety/panic episodes (racing heart, trembling, feelings of impending doom/choking), appetite and energy changes, distressing thoughts, and primary ongoing psychosocial stressors.";
  }
  if (dept.includes("surg") || dept.includes("wound") || dept.includes("hernia") || dept.includes("lump") || dept.includes("ulcer")) {
    return "Surgery: Focus on onset, size changes, and consistency of lump/swelling/wound (rapid enlargement, tenderness, discharge), reducible vs painful irreducible/incarcerated hernia (cough impulse), acute abdominal pain (sudden onset, guarding, rigidity), signs of bowel obstruction (inability to pass flatus or stool, abdominal distension, bilious vomiting), and non-healing chronic ulcers.";
  }
  if (dept.includes("dent") || dept.includes("tooth") || dept.includes("teeth") || dept.includes("oral") || dept.includes("gum")) {
    return "Dentistry: Focus on specific tooth/quadrant localization, pain triggers (sharp pain with cold, hot, or sweets vs dull ache with biting/chewing), spontaneous throbbing pain waking patient up at night (irreversible pulpitis), gum swelling, tenderness, bleeding or pus discharge (abscess), loose/mobile teeth, and limitation in mouth opening (trismus).";
  }
  if (dept.includes("panchakarma")) {
    return "AYUSH - Panchakarma: Focus on Ama assessment (coated tongue, morning body heaviness, joint stiffness, lethargy, bad breath), bowel evacuation regularity and digestion before detoxification, history of prior Shodhana (Vamana, Virechana, Basti, Nasya, Raktamokshana) therapies, and tolerance to medicated oils/ghee.";
  }
  if (dept.includes("yoga") || dept.includes("naturopath")) {
    return "AYUSH - Yoga & Naturopathy: Focus on Dinacharya and lifestyle habits (waking/sleep schedule, daily physical activity, stress levels), spinal/joint flexibility and pain on specific postures, breath stamina and tolerance to deep breathing/Pranayama, dietary balance (raw foods, water intake, Satvik vs processed foods), and vitality levels.";
  }
  if (dept.includes("ayush") || dept.includes("ayurved")) {
    return "AYUSH - Ayurveda: Focus on Agni assessment (appetite strength, digestion duration, bloating/heaviness after food), Koshtha (daily bowel pattern: dry-constipated Krura vs loose Mridu vs regular Madhyama), Prakriti/Dosha imbalance (Vata/Pitta/Kapha physical and mental indicators), Sheet/Ushna thermal affinity (cold vs heat intolerance), and daily Ahara-Vihara (dietary patterns, sleep quality, daily routine).";
  }
  return "General Medicine: Focus on precise chronological onset, fever pattern (continuous vs intermittent spikes with chills/rigors), localized vs multi-system constitutional symptoms (unexplained weight loss, drenching night sweats, profound weakness), and systemic red flags.";
}

export async function POST(req: Request) {
  if (!rateLimit(routeRateLimitKey(req), 20, 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many requests. Try again shortly." }, { status: 429 });
  }
  // Each call spends the hospital's model budget, so a cross-site page must
  // not be able to drive it through a visitor's browser.
  const csrf = csrfGuard(req);
  if (!csrf.ok) return NextResponse.json({ ok: false, error: csrf.error }, { status: 403 });
  if (bodyTooLarge(req, 128 * 1024)) return payloadTooLarge();
  const body = await req.json().catch(() => ({}));
  const parsed = safeParse(converseRequestSchema, body);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

  // The patient's words go to an external model provider — same rule as every
  // other external-AI path. Without the explicit scope the kiosk stays on the
  // guided (rules) interview flow.
  if (!canUseExternalModel(parsed.data.consent)) {
    return NextResponse.json(
      { ok: false, error: "AI follow-up needs the patient's AI-processing consent. Continue with the guided questions." },
      { status: 403 }
    );
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "OPENAI_API_KEY not set. Run guided flow instead." },
      { status: 501 }
    );
  }

  // Normalize ("hi-IN" → "hi", case-insensitive): any unrecognized code
  // silently fell through to English, showing the patient an English
  // question regardless of their chosen language.
  const langCode = (parsed.data.language ?? "en").split("-")[0].toLowerCase();
  const langName = LANGUAGE_NAMES[langCode] ?? "English";
  const dept = parsed.data.department?.trim() || "General Medicine";
  const deptGuidance = getDepartmentClinicalGuidance(dept);

  const system =
    `You are an expert clinical history-taking AI interviewer at an Indian hospital OPD kiosk, consulting specifically for the "${dept}" OPD Department.\n\n` +
    `DEPARTMENT CLINICAL SPECIALTY FOCUS:\n${deptGuidance}\n\n` +
    `YOUR MANDATE:\n` +
    `The patient has chosen the "${dept}" department and described their complaint and history so far.\n` +
    `Generate exactly ONE concise, high-yield diagnostic question that is SPECIFIC to the "${dept}" specialty and investigates the single most critical clinical discriminator needed by the ${dept} specialist to differentiate diagnoses.\n\n` +
    `RULES FOR CLINICAL SPECIFICITY:\n` +
    `1. DEPARTMENT SPECIALIZATION: The question MUST be tightly tailored to "${dept}". Even if the patient's chief complaint is generic (e.g., pain, fever, fatigue), frame the question specifically around "${dept}" pathology and clinical markers.\n` +
    `2. HIGH DIAGNOSTIC YIELD: Probe key clinical discriminators (e.g., exact triggers, exertional relation, radiation, timing/duration, anatomical quality, or specialty-specific red flags) described in the Department Clinical Focus above.\n` +
    `3. 2-3 CLEAR CHOICES: Formulate the question in simple everyday language with 2 to 3 distinct choices (e.g., "Is it A, B, or C?") so a patient at the kiosk can easily tap or speak their answer.\n` +
    `4. NO REPETITION: Do NOT re-ask details already answered in the patient's history so far.\n` +
    `5. CONCISE: Keep the entire question under 25 words.\n` +
    `6. LANGUAGE: Output the question ONLY in ${langName} — never in English unless ${langName} is English. Every word the patient reads must be in ${langName}.\n` +
    `7. COMPLETION: If all critical department-specific information is already fully elicited, reply with exactly "HISTORY_COMPLETE".`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      // A hung provider must fail into the guided flow, not wedge the kiosk.
      signal: AbortSignal.timeout(Number(process.env.OPENAI_TIMEOUT_MS ?? 20_000)),
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.3,
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: `Selected OPD Department: ${dept}\nChief Complaint: ${parsed.data.chiefComplaint ?? "—"}\n\nPatient's history & answers so far:\n${parsed.data.hpi ?? "—"}\n\nPrior questions already asked:\n${parsed.data.priorQuestions ?? "—"}\n\nPlease ask the single most important ${dept}-specific diagnostic follow-up question in ${langName}.`,
          },
        ],
      }),
    });
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: "Follow-up question failed." }, { status: 502 });
    }
    const data = await res.json().catch(() => null);
    const text: string = data?.choices?.[0]?.message?.content ?? "";
    if (!text.trim()) {
      return NextResponse.json({ ok: false, error: "Follow-up question failed." }, { status: 502 });
    }
    return NextResponse.json({ ok: true, question: text.trim(), complete: text.includes("HISTORY_COMPLETE") });
  } catch {
    return NextResponse.json({ ok: false, error: "Follow-up question failed." }, { status: 500 });
  }
}