"use client";

import type { ConsentState } from "./types";

export type SpeechStatus = "idle" | "listening" | "error";

type SpeechResultEvent = {
  resultIndex?: number;
  results: {
    length?: number;
    [index: number]: { isFinal?: boolean; [index: number]: { transcript: string } };
  };
};

/**
 * Join recognized final segments into one transcript, each counted once.
 * Interim text must never be passed here — it is display-only and would
 * otherwise duplicate once its final arrives.
 */
export function joinFinals(parts: Array<string | null | undefined>): string {
  return parts
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Append a new voice transcript to existing field text in chronological
 * order. Tapping the mic again must extend the description, never wipe what
 * the patient already dictated. Blank transcripts leave the field untouched.
 */
export function appendVoiceText(prev: string, next: string): string {
  const clean = next.trim().replace(/\s+/g, " ");
  if (!clean) return prev;
  if (!prev.trim()) return clean;
  return `${prev.trimEnd()} ${clean}`;
}

type Capabilities = {
  capabilities?: {
    asrBackend?: boolean;
    llm?: boolean;
  };
};

let capsPromise: Promise<Capabilities> | null = null;

/** Probe server capabilities once and cache for this page view. */
export function getCapabilities(): Promise<Capabilities> {
  if (!capsPromise) {
    // A failed probe must not be cached: loading the kiosk offline (or one
    // 500 from /api/config) would otherwise pin every later recording to the
    // Web Speech fallback even after the network and backend recover.
    capsPromise = fetch("/api/config")
      .then((r) => r.json().catch(() => ({})))
      .catch(() => {
        capsPromise = null;
        return {};
      });
  }
  return capsPromise;
}

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "webkitSpeechRecognition" in window;
}

export function microphoneSupported(): boolean {
  return typeof window !== "undefined" && navigator.mediaDevices?.getUserMedia !== undefined && "MediaRecorder" in window;
}

export function speak(text: string, lang = "hi-IN") {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  // First tap on a cold boot often races voice-pack loading (getVoices() ===
  // [] until `voiceschanged`): speaking immediately then comes out in the
  // wrong voice or not at all — worst for minority locales like pa-IN.
  // Defer just past voice readiness instead of speaking half-loaded.
  ensureVoices().then(() => speakNow(text, lang));
}

function speakNow(text: string, lang: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 0.95;
  // Kiosk devices (especially lean Windows/Android images) often ship no
  // voice for minority locales like pa-IN — an exact-only match then leaves
  // utter.voice unset and the utterance comes out in the wrong voice or not
  // at all. Fall back: exact locale → base language → Hindi (closest widely
  // installed Indic voice) → English → system default. Never silent.
  const voices = currentVoices();
  const base = lang.split("-")[0];
  const matching =
    voices.find((v) => v.lang === lang) ??
    voices.find((v) => v.lang === base || v.lang.startsWith(`${base}-`)) ??
    voices.find((v) => v.lang === "hi-IN" || v.lang.startsWith("hi-")) ??
    voices.find((v) => v.lang === "en-IN" || v.lang.startsWith("en-")) ??
    voices[0];
  if (matching) {
    // Adopt the MATCHED voice's locale on the utterance: several mobile TTS
    // engines (notably Android WebView/Google TTS) stay silent when utter.lang
    // names a locale the chosen voice doesn't serve (e.g. pa-IN text on a
    // hi-IN voice). Audible with an accent beats silence.
    utter.voice = matching;
    utter.lang = matching.lang || lang;
  } else {
    utter.lang = lang;
  }
  window.speechSynthesis.speak(utter);
}

/**
 * Voice list with async warmup.
 *
 * `speechSynthesis.getVoices()` famously returns [] until the browser has
 * loaded its voice packs (the `voiceschanged` event) — the first speak() on a
 * fresh kiosk boot would otherwise see no voices at all and skip voice
 * matching entirely. Warm the cache at module load and keep it fresh, so by
 * the time a patient taps a listen button the list is populated.
 */
let warmedVoices: SpeechSynthesisVoice[] | null = null;
let voiceReady: Promise<void> | null = null;

/** Resolve once the browser's voice packs are listed (or 1.2s, whichever first). */
function ensureVoices(): Promise<void> {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return Promise.resolve();
  try {
    const list = window.speechSynthesis.getVoices();
    if (list.length) {
      warmedVoices = list;
      return Promise.resolve();
    }
  } catch {
    return Promise.resolve();
  }
  if (!voiceReady) {
    voiceReady = new Promise((res) => {
      const done = () => {
        try {
          warmedVoices = window.speechSynthesis.getVoices();
        } catch {
          /* ignore */
        }
        res();
      };
      try {
        window.speechSynthesis.addEventListener("voiceschanged", done, { once: true });
      } catch {
        res();
        return;
      }
      window.setTimeout(() => res(), 1200);
    });
  }
  return voiceReady;
}

if (typeof window !== "undefined" && "speechSynthesis" in window) {
  // Warm the cache at module load; ensureVoices() re-warms if this fired early.
  try {
    const list = window.speechSynthesis.getVoices();
    if (list.length) warmedVoices = list;
    window.speechSynthesis.addEventListener("voiceschanged", () => {
      try {
        warmedVoices = window.speechSynthesis.getVoices();
      } catch {
        /* ignore */
      }
    });
  } catch {
    /* older webviews without EventTarget on speechSynthesis */
  }
}

function currentVoices(): SpeechSynthesisVoice[] {
  if (warmedVoices?.length) return warmedVoices;
  try {
    const list = window.speechSynthesis.getVoices();
    if (list.length) warmedVoices = list;
    return list;
  } catch {
    return [];
  }
}

export type GuidanceStage = "welcome" | "identify" | "history" | "scan" | "summary" | "done";

export const STAGE_AUDIO_PROMPTS: Record<GuidanceStage, Record<string, string>> = {
  welcome: {
    en: "Welcome to MediKiosk. Please select your preferred language to begin.",
    hi: "मेडीकियोस्क में आपका स्वागत है। कृपया शुरू करने के लिए अपनी भाषा चुनें।",
    bn: "মেডিকিয়স্কে স্বাগতম। শুরু করতে আপনার ভাষা নির্বাচন করুন।",
    ta: "மெடிக்கியோஸ்க்கிற்கு வரவேற்கிறோம். தொடங்க உங்கள் மொழியைத் தேர்ந்தெடுக்கவும்.",
    te: "మెడికియోస్క్కు స్వాగతం. ప్రారంభించడానికి మీ భాషను ఎంచుకోండి.",
    mr: "मेडिकियोस्कमध्ये आपले स्वागत आहे. सुरू करण्यासाठी कृपया आपली भाषा निवडा.",
    gu: "મેડિકિયોસ્કમાં આપનું સ્વાગત છે. શરૂ કરવા માટે આપની ભાષા પસંદ કરો.",
    kn: "ಮೆಡಿಕಿಯೋಸ್ಕ್ಗೆ ಸ್ವಾಗತ. ಪ್ರಾರಂಭಿಸಲು ದಯವಿಟ್ಟು ನಿಮ್ಮ ಭಾಷೆಯನ್ನು ಆಯ್ಕೆಮಾಡಿ.",
    ml: "മെഡികിയോസ്കിലേക്ക് സ്വാഗതം. ആരംഭിക്കാൻ നിങ്ങളുടെ ഭാഷ തിരഞ്ഞെടുക്കുക.",
    pa: "ਮੇਡਿਕੀਓਸਕ ਵਿੱਚ ਸੁਆਗਤ ਹੈ। ਸ਼ੁਰੂ ਕਰਨ ਲਈ ਆਪਣੀ ਭਾਸ਼ਾ ਚੁਣੋ।",
  },
  identify: {
    en: "Please enter your ABHA ID or mobile number, or scan your card QR code.",
    hi: "कृपया अपना आभा आईडी या मोबाइल नंबर दर्ज करें, या क्यूआर कोड स्कैन करें।",
    bn: "দয়া করে আপনার আভা আইডি বা মোবাইল নম্বর লিখুন, অথবা কিউআর কোড স্ক্যান করুন।",
    ta: "உங்கள் ஆபா ஐடி அல்லது மொபைல் எண்ணை உள்ளிடவும், அல்லது க்யூஆர் குறியீட்டை ஸ்கேன் செய்யவும்.",
    te: "దయచేసి మీ ఆభా ఐడీ లేదా మొబైల్ నంబర్ నమోదు చేయండి, లేదా క్యూఆర్ కోడ్ స్కాన్ చేయండి.",
    mr: "कृपया तुमचा आभा आयडी किंवा मोबाइल नंबर टाका, किंवा क्यूआर कोड स्कॅन करा.",
    gu: "કૃપા કરીને તમારો આભા આઈડી અથવા મોબાઈલ નંબર દાખલ કરો, અથવા ક્યુઆર કોડ સ્કેન કરો.",
    kn: "ದಯವಿಟ್ಟು ನಿಮ್ಮ ಆಭಾ ಐಡಿ ಅಥವಾ ಮೊಬೈಲ್ ಸಂಖ್ಯೆಯನ್ನು ನಮೂದಿಸಿ, ಅಥವಾ ಕ್ಯೂಆರ್ ಕೋಡ್ ಸ್ಕ್ಯಾನ್ ಮಾಡಿ.",
    ml: "ദയവായി നിങ്ങളുടെ ആഭാ ഐഡിയോ മൊബൈൽ നമ്പറോ നൽകുക, അല്ലെങ്കിൽ ക്യുആർ കോഡ് സ്കാൻ ചെയ്യുക.",
    pa: "ਕਿਰਪਾ ਕਰਕੇ ਆਪਣਾ ਆਭਾ ਆਈਡੀ ਜਾਂ ਮੋਬਾਈਲ ਨੰਬਰ ਦਰਜ ਕਰੋ, ਜਾਂ ਕਿਊਆਰ ਕੋਡ ਸਕੈਨ ਕਰੋ।",
  },
  history: {
    en: "Tell us your symptoms by speaking into the microphone, tapping the screen, or using the body map.",
    hi: "माइक में बोलकर, स्क्रीन पर टैप करके, या बॉडी मैप का उपयोग करके अपनी समस्या बताएं।",
    bn: "মাইকে কথা বলে, স্ক্রিনে ট্যাপ করে অথবা বডি ম্যাপ ব্যবহার করে আপনার সমস্যার কথা জানান।",
    ta: "மைக்கில் பேசியோ, திரையைத் தொட்டோ அல்லது உடல் வரைபடத்தைப் பயன்படுத்தியோ உங்கள் பிரச்சனையைத் தெரிவிக்கவும்.",
    te: "మైక్‌లో మాట్లాడి, స్క్రీన్‌పై ట్యాప్ చేసి లేదా బాడీ మ్యాప్‌ని ఉపయోగించి మీ సమస్యను చెప్పండి.",
    mr: "माईकमध्ये बोलून, स्क्रीनवर टॅप करून किंवा बॉडी मॅप वापरून आपली समस्या सांगा.",
    gu: "માઈકમાં બોલીને, સ્ક્રીન પર ટૅપ કરીને અથવા બૉડી મૅપ દ્વારા તમારી તકલીફ જણાવો.",
    kn: "ಮೈಕ್‌ನಲ್ಲಿ ಮಾತನಾಡಿ, ಪರದೆಯನ್ನು ಸ್ಪರ್ಶಿಸಿ ಅಥವಾ ಬಾಡಿ ಮ್ಯಾಪ್ ಬಳಸಿ ನಿಮ್ಮ ಸಮಸ್ಯೆಯನ್ನು ತಿಳಿಸಿ.",
    ml: "മൈക്കിൽ സംസാരിച്ചോ, സ്ക്രീനിൽ തൊട്ടോ, ബോഡി മാപ്പ് ഉപയോഗിച്ചോ നിങ്ങളുടെ ബുദ്ധിമുട്ടുകൾ പറയുക.",
    pa: "ਮਾਈਕ ਵਿੱਚ ਬੋਲ ਕੇ, ਸਕ੍ਰੀਨ 'ਤੇ ਟੈਪ ਕਰਕੇ ਜਾਂ ਬਾਡੀ ਮੈਪ ਦੀ ਵਰਤੋਂ ਕਰਕੇ ਆਪਣੀ ਸਮੱਸਿਆ ਦੱਸੋ।",
  },
  scan: {
    en: "Upload or capture photos of your past prescriptions, lab reports, or discharge summaries.",
    hi: "कृपया अपने पुराने पर्चे, जांच रिपोर्ट या डिस्चार्ज समरी की फोटो अपलोड करें।",
    bn: "আপনার পূর্বের প্রেসক্রিপশন বা ল্যাব রিপোর্টের ছবি আপলোড করুন।",
    ta: "உங்கள் பழைய மருந்துச் சீட்டுகள் அல்லது ஆய்வு அறிக்கைகளைப் பதிவேற்றவும்.",
    te: "మీ పాత ప్రిస్క్రిప్షన్లు లేదా ల్యాబ్ నివేదికలను అప్‌లోడ్ చేయండి.",
    mr: "कृपया आपले जुने प्रिस्क्रिप्शन किंवा लॅब रिपोर्ट अपलोड करा.",
    gu: "કૃપા કરીને તમારા જૂના પ્રિસ્ક્રિપ્શન અથવા રિપોર્ટ અપલોડ કરો.",
    kn: "ನಿಮ್ಮ ಹಳೆಯ ಪ್ರಿಸ್ಕ್ರಿಪ್ಷನ್ ಅಥವಾ ಲ್ಯಾಬ್ ವರದಿಗಳನ್ನು ಅಪ್‌ಲೋಡ್ ಮಾಡಿ.",
    ml: "നിങ്ങളുടെ പഴയ കുറിപ്പടികളോ ലാബ് റിപ്പോർട്ടുകളോ അപ്‌ലോഡ് ചെയ്യുക.",
    pa: "ਕਿਰਪਾ ਕਰਕੇ ਆਪਣੀਆਂ ਪੁਰਾਣੀਆਂ ਪਰਚੀਆਂ ਜਾਂ ਲੈਬ ਰਿਪੋਰਟਾਂ ਅਪਲੋਡ ਕਰੋ।",
  },
  summary: {
    en: "Please review your medical history summary and confirm to receive your OPD token.",
    hi: "कृपया अपने केस हिस्ट्री सारांश की जांच करें और टोकन प्राप्त करने के लिए पुष्टि करें।",
    bn: "আপনার কেস হিস্ট্রি সারাংশ পর্যালোচনা করুন এবং ওপিডি টোকেন পেতে নিশ্চিত করুন।",
    ta: "உங்கள் மருத்துவ விவரங்களைச் சரிபார்த்து டோக்கனைப் பெற உறுதிப்படுத்தவும்.",
    te: "మీ కేస్ హిస్టరీని సమీక్షించి టోకెన్ పొందడానికి నిర్ధారించండి.",
    mr: "कृपया आपल्या केस हिस्ट्रीचा सारांश तपासा आणि टोकन मिळवण्यासाठी पुष्टी करा.",
    gu: "કૃપા કરીને તમારા કેસનો સારાંશ તપાસો અને ટોકન મેળવવા માટે પુષ્ટિ કરો.",
    kn: "ದಯವಿಟ್ಟು ನಿಮ್ಮ ವಿವರಗಳನ್ನು ಪರಿಶೀಲಿಸಿ ಟೋಕನ್ ಪಡೆಯಲು ದೃಢೀಕರಿಸಿ.",
    ml: "നിങ്ങളുടെ വിവരങ്ങൾ പരിശോധിച്ച് ടോക്കൺ ലഭിക്കുന്നതിന് സ്ഥിരീകരിക്കുക.",
    pa: "ਕਿਰਪਾ ਕਰਕੇ ਆਪਣੇ ਵੇਰਵਿਆਂ ਦੀ ਸਮੀਖਿਆ ਕਰੋ ਅਤੇ ਟੋਕਨ ਪ੍ਰਾਪਤ ਕਰਨ ਲਈ ਪੁਸ਼ਟੀ ਕਰੋ।",
  },
  done: {
    en: "Your registration is complete. Please collect your printed token and wait for your turn.",
    hi: "आपका पंजीकरण पूरा हो गया है। कृपया अपना टोकन लें और प्रतीक्षा कक्ष में बैठें।",
    bn: "আপনার রেজিস্ট্রেশন সম্পন্ন হয়েছে। অনুগ্রহ করে টোকেন নিন এবং অপেক্ষাগারে বসুন।",
    ta: "உங்கள் பதிவு முடிந்தது. டோக்கனை எடுத்துக்கொண்டு காத்திருக்கவும்.",
    te: "మీ నమోదు పూర్తయింది. దయచేసి టోకెన్ తీసుకుని వేచి ఉండండి.",
    mr: "आपली नोंदणी पूर्ण झाली आहे. कृपया टोकन घ्या आणि प्रतीक्षा करा.",
    gu: "તમારી નોંધણી પૂર્ણ થઈ ગઈ છે. કૃપા કરીને ટોકન લો અને રાહ જુઓ.",
    kn: "ನಿಮ್ಮ ನೋಂದಣಿ ಪೂರ್ಣಗೊಂಡಿದೆ. ದಯವಿಟ್ಟು ಟೋಕನ್ ಪಡೆದು ಕಾಯಿರಿ.",
    ml: "നിങ്ങളുടെ രജിസ്ട്രേഷൻ പൂർത്തിയായി. ദയവായി ടോക്കൺ എടുത്ത് കാത്തിരിക്കുക.",
    pa: "ਤੁਹਾਡੀ ਰਜਿਸਟ੍ਰੇਸ਼ਨ ਪੂਰੀ ਹੋ ਗਈ ਹੈ। ਕਿਰਪਾ ਕਰਕੇ ਟੋਕਨ ਲਵੋ ਅਤੇ ਇੰਤਜ਼ਾਰ ਕਰੋ।",
  },
};

export function speakGuidance(stage: GuidanceStage, langCode = "en", voiceCode = "en-IN") {
  if (typeof window === "undefined") return;
  const promptMap = STAGE_AUDIO_PROMPTS[stage];
  if (!promptMap) return;
  // Callers pass base codes ("hi") or BCP-47 ("hi-IN") interchangeably —
  // strip the region before lookup so "hi-IN" does not fall back to English.
  const base = langCode.split("-")[0] || langCode;
  const text = promptMap[langCode] ?? promptMap[base] ?? promptMap["en"] ?? "";
  if (text) {
    speak(text, voiceCode);
  }
}

/**
 * Spoken consent explanation, one per kiosk language.
 *
 * A low-literacy patient cannot read the consent panel, so this script IS the
 * consent disclosure for them — it must speak their language, not default to
 * Hindi. Each script states the same three facts (record + ABHA link + share
 * with the treating doctor; revocable anytime) in plain words.
 *
 * NOTE for production: clinical-consent wording should be verified by a
 * native-speaking clinician per language before deployment. The map structure
 * makes that review a text swap, not a code change.
 */
export type ConsentScript = { patient: string; guardian: string; thanks: string };

const CONSENT_AUDIO_SCRIPTS: Record<string, ConsentScript> = {
  hi: {
    patient:
      "मैं अपनी चिकित्सीय जानकारी MediKiosk में दर्ज करने, अपने ABHA रिकॉर्ड से जोड़ने, तथा इस अस्पताल के डॉक्टर के साथ साझा करने के लिए सहमत हूँ। यह सहमति किसी भी समय वापस ली जा सकती है।",
    guardian:
      "रोगी के अभिभावक के रूप में, मैं रोगी की चिकित्सीय जानकारी दर्ज करने और डॉक्टर के साथ साझा करने के लिए सहमत हूँ। यह सहमति किसी भी समय वापस ली जा सकती है।",
    thanks: "धन्यवाद! आपने अपनी जानकारी साझा करने की अनुमति दी है।",
  },
  en: {
    patient:
      "I agree to record my health information in MediKiosk, link it to my ABHA record, and share it with this hospital's doctor. I can withdraw this consent at any time.",
    guardian:
      "As the patient's guardian, I agree to record the patient's health information and share it with the treating doctor. I can withdraw this consent at any time.",
    thanks: "Thank you! You have allowed your information to be shared.",
  },
  bn: {
    patient:
      "আমি আমার স্বাস্থ্য তথ্য MediKiosk-এ নথিভুক্ত করতে, আমার ABHA রেকর্ডের সাথে যুক্ত করতে এবং এই হাসপাতালের ডাক্তারের সাথে ভাগ করে নিতে সম্মত আছি। এই সম্মতি আমি যেকোনো সময় প্রত্যাহার করতে পারি।",
    guardian:
      "রোগীর অভিভাবক হিসেবে, আমি রোগীর স্বাস্থ্য তথ্য নথিভুক্ত করতে এবং চিকিৎসক ডাক্তারের সাথে ভাগ করে নিতে সম্মত আছি। এই সম্মতি যেকোনো সময় প্রত্যাহার করা যেতে পারে।",
    thanks: "ধন্যবাদ! আপনি আপনার তথ্য ভাগ করে নেওয়ার অনুমতি দিয়েছেন।",
  },
  ta: {
    patient:
      "எனது உடல்நல தகவல்களை MediKiosk-இல் பதிவு செய்யவும், எனது ABHA பதிவுடன் இணைக்கவும், இந்த மருத்துவமனை மருத்துவருடன் பகிரவும் நான் சம்மதிக்கிறேன். இந்த சம்மதத்தை நான் எப்போது வேண்டுமானாலும் திரும்பப் பெறலாம்.",
    guardian:
      "நோயாளியின் பாதுகாவலர் என்ற முறையில், நோயாளியின் தகவல்களைப் பதிவு செய்யவும் மருத்துவருடன் பகிரவும் சம்மதிக்கிறேன். இந்த சம்மதத்தை எப்போது வேண்டுமானாலும் திரும்பப் பெறலாம்.",
    thanks: "நன்றி! உங்கள் தகவல்களைப் பகிர அனுமதி அளித்துள்ளீர்கள்.",
  },
  te: {
    patient:
      "నా ఆరోగ్య సమాచారాన్ని MediKioskలో నమోదు చేయడానికి, నా ABHA రికార్డుతో అనుసంధానించడానికి మరియు ఈ ఆసుపత్రి డాక్టరుతో పంచుకోవడానికి నేను అంగీకరిస్తున్నాను. ఈ అంగీకారాన్ని నేను ఎప్పుడైనా ఉపసంహరించుకోవచ్చు.",
    guardian:
      "రోగి సంరక్షకుడిగా, రోగి సమాచారాన్ని నమోదు చేయడానికి మరియు డాక్టరుతో పంచుకోవడానికి అంగీకరిస్తున్నాను. ఈ అంగీకారాన్ని ఎప్పుడైనా ఉపసంహరించుకోవచ్చు.",
    thanks: "ధన్యవాదాలు! మీ సమాచారాన్ని పంచుకోవడానికి మీరు అనుమతి ఇచ్చారు.",
  },
  mr: {
    patient:
      "माझी आरोग्य माहिती MediKiosk मध्ये नोंदवण्यास, माझ्या ABHA रेकॉर्डशी जोडण्यास आणि या रुग्णालयातील डॉक्टरांशी शेअर करण्यास माझी संमती आहे. ही संमती कधीही मागे घेता येईल.",
    guardian:
      "रुग्णाचा पालक म्हणून, रुग्णाची माहिती नोंदवण्यास आणि डॉक्टरांशी शेअर करण्यास माझी संमती आहे. ही संमती कधीही मागे घेता येईल.",
    thanks: "धन्यवाद! तुम्ही तुमची माहिती शेअर करण्यास परवानगी दिली आहे.",
  },
  gu: {
    patient:
      "હું મારી આરોગ્ય માહિતી MediKioskમાં નોંધવા, મારા ABHA રેકોર્ડ સાથે જોડવા અને આ હોસ્પિટલના ડૉક્ટર સાથે શેર કરવા સંમત છું. આ સંમતિ હું કોઈપણ સમયે પાછી ખેંચી શકું છું.",
    guardian:
      "દર્દીના વાલી તરીકે, હું દર્દીની માહિતી નોંધવા અને ડૉક્ટર સાથે શેર કરવા સંમત છું. આ સંમતિ કોઈપણ સમયે પાછી ખેંચી શકાય છે.",
    thanks: "આભાર! તમે તમારી માહિતી શેર કરવાની પરવાનગી આપી છે.",
  },
  kn: {
    patient:
      "ನನ್ನ ಆರೋಗ್ಯ ಮಾಹಿತಿಯನ್ನು MediKioskನಲ್ಲಿ ದಾಖಲಿಸಲು, ನನ್ನ ABHA ದಾಖಲೆಗೆ ಜೋಡಿಸಲು ಮತ್ತು ಈ ಆಸ್ಪತ್ರೆಯ ವೈದ್ಯರೊಂದಿಗೆ ಹಂಚಿಕೊಳ್ಳಲು ನಾನು ಒಪ್ಪುತ್ತೇನೆ. ಈ ಒಪ್ಪಿಗೆಯನ್ನು ನಾನು ಯಾವಾಗ ಬೇಕಾದರೂ ಹಿಂಪಡೆಯಬಹುದು.",
    guardian:
      "ರೋಗಿಯ ಪೋಷಕನಾಗಿ, ರೋಗಿಯ ಮಾಹಿತಿಯನ್ನು ದಾಖಲಿಸಲು ಮತ್ತು ವೈದ್ಯರೊಂದಿಗೆ ಹಂಚಿಕೊಳ್ಳಲು ಒಪ್ಪುತ್ತೇನೆ. ಈ ಒಪ್ಪಿಗೆಯನ್ನು ಯಾವಾಗ ಬೇಕಾದರೂ ಹಿಂಪಡೆಯಬಹುದು.",
    thanks: "ಧನ್ಯವಾದಗಳು! ನಿಮ್ಮ ಮಾಹಿತಿಯನ್ನು ಹಂಚಿಕೊಳ್ಳಲು ನೀವು ಅನುಮತಿ ನೀಡಿದ್ದೀರಿ.",
  },
  ml: {
    patient:
      "എന്റെ ആരോഗ്യ വിവരങ്ങൾ MediKiosk-ൽ രേഖപ്പെടുത്താനും, എന്റെ ABHA റെക്കോർഡുമായി ബന്ധിപ്പിക്കാനും, ഈ ആശുപത്രിയിലെ ഡോക്ടറുമായി പങ്കിടാനും ഞാൻ സമ്മതിക്കുന്നു. ഈ സമ്മതം എനിക്ക് എപ്പോൾ വേണമെങ്കിലും പിൻവലിക്കാം.",
    guardian:
      "രോഗിയുടെ രക്ഷാകർത്താവ് എന്ന നിലയിൽ, രോഗിയുടെ വിവരങ്ങൾ രേഖപ്പെടുത്താനും ഡോക്ടറുമായി പങ്കിടാനും ഞാൻ സമ്മതിക്കുന്നു. ഈ സമ്മതം എപ്പോൾ വേണമെങ്കിലും പിൻവലിക്കാം.",
    thanks: "നന്ദി! നിങ്ങളുടെ വിവരങ്ങൾ പങ്കിടാൻ നിങ്ങൾ അനുമതി നൽകി.",
  },
  pa: {
    patient:
      "ਮੈਂ ਆਪਣੀ ਸਿਹਤ ਜਾਣਕਾਰੀ MediKiosk ਵਿੱਚ ਦਰਜ ਕਰਨ, ਆਪਣੇ ABHA ਰਿਕਾਰਡ ਨਾਲ ਜੋੜਨ ਅਤੇ ਇਸ ਹਸਪਤਾਲ ਦੇ ਡਾਕਟਰ ਨਾਲ ਸਾਂਝੀ ਕਰਨ ਲਈ ਸਹਿਮਤ ਹਾਂ। ਇਹ ਸਹਿਮਤੀ ਕਿਸੇ ਵੀ ਸਮੇਂ ਵਾਪਸ ਲਈ ਜਾ ਸਕਦੀ ਹੈ।",
    guardian:
      "ਮਰੀਜ਼ ਦੇ ਸਰਪ੍ਰਸਤ ਵਜੋਂ, ਮੈਂ ਮਰੀਜ਼ ਦੀ ਜਾਣਕਾਰੀ ਦਰਜ ਕਰਨ ਅਤੇ ਡਾਕਟਰ ਨਾਲ ਸਾਂਝੀ ਕਰਨ ਲਈ ਸਹਿਮਤ ਹਾਂ। ਇਹ ਸਹਿਮਤੀ ਕਿਸੇ ਵੀ ਸਮੇਂ ਵਾਪਸ ਲਈ ਜਾ ਸਕਦੀ ਹੈ।",
    thanks: "ਧੰਨਵਾਦ! ਤੁਸੀਂ ਆਪਣੀ ਜਾਣਕਾਰੀ ਸਾਂਝੀ ਕਰਨ ਦੀ ਆਗਿਆ ਦਿੱਤੀ ਹੈ।",
  },
};

/**
 * Consent script for a UI language code, falling back through Hindi to
 * English. Never returns an empty script — a missing language must degrade to
 * a spoken explanation, not silence.
 */
export function consentAudioScript(langCode = "en"): ConsentScript {
  return (
    CONSENT_AUDIO_SCRIPTS[langCode] ??
    CONSENT_AUDIO_SCRIPTS[langCode.split("-")[0]] ??
    CONSENT_AUDIO_SCRIPTS.hi ??
    CONSENT_AUDIO_SCRIPTS.en
  );
}

/**
 * Short dynamic kiosk phrases, one per language.
 *
 * These are spoken (never shown as text), so they live here next to the other
 * audio scripts rather than in the UI dictionary. Every phrase degrades to
 * English for an unknown language — a missing translation must never silence
 * guidance a patient is waiting to hear.
 */
export const KIOSK_SPEECH: Record<string, Record<string, string>> = {
  returningGreeting: {
    en: "Hello! We found your previous visit — please verify and continue.",
    hi: "नमस्ते! आपका पिछला प्रवेश मिल गया — कृपया फिर से जांचें और आगे बढ़ें।",
    bn: "নমস্কার! আপনার আগের পরিদর্শন পাওয়া গেছে — যাচাই করে এগিয়ে যান।",
    ta: "வணக்கம்! உங்கள் முந்தைய வருகை கிடைத்தது — சரிபார்த்துத் தொடரவும்.",
    te: "నమస్కారం! మీ మునుపటి సందర్శన దొరికింది — ధృవీకరించి కొనసాగండి.",
    mr: "नमस्कार! तुमची मागील भेट सापडली — तपासून पुढे जा.",
    gu: "નમસ્તે! તમારી અગાઉની મુલાકાત મળી — ચકાસીને આગળ વધો.",
    kn: "ನಮಸ್ಕಾರ! ನಿಮ್ಮ ಹಿಂದಿನ ಭೇಟಿ ಸಿಕ್ಕಿದೆ — ಪರಿಶೀಲಿಸಿ ಮುಂದುವರಿಸಿ.",
    ml: "നമസ്കാരം! നിങ്ങളുടെ മുൻ സന്ദർശനം കിട്ടി — പരിശോധിച്ച് തുടരുക.",
    pa: "ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ! ਤੁਹਾਡੀ ਪਿਛਲੀ ਫੇਰੀ ਮਿਲ ਗਈ — ਜਾਂਚ ਕਰਕੇ ਅੱਗੇ ਵਧੋ।",
  },
  returningDetails: {
    en: "Hello {name}! We found your previous details.",
    hi: "नमस्ते {name}! आपके पिछले विवरण मिल गए हैं।",
    bn: "নমস্কার {name}! আপনার আগের বিবরণ পাওয়া গেছে।",
    ta: "வணக்கம் {name}! உங்கள் முந்தைய விவரங்கள் கிடைத்தன.",
    te: "నమస్కారం {name}! మీ మునుపటి వివరాలు దొరికాయి.",
    mr: "नमस्कार {name}! तुमचे मागील तपशील सापडले.",
    gu: "નમસ્તે {name}! તમારી અગાઉની વિગતો મળી.",
    kn: "ನಮಸ್ಕಾರ {name}! ನಿಮ್ಮ ಹಿಂದಿನ ವಿವರಗಳು ಸಿಕ್ಕಿವೆ.",
    ml: "നമസ്കാരം {name}! നിങ്ങളുടെ മുൻ വിവരങ്ങൾ കിട്ടി.",
    pa: "ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ {name}! ਤੁਹਾਡੇ ਪਿਛਲੇ ਵੇਰਵੇ ਮਿਲ ਗਏ ਹਨ।",
  },
  thanksSelf: {
    en: "Thank you {name}. Now you can describe your problem.",
    hi: "धन्यवाद {name}। अब आप अपनी परेशानी बता सकते हैं।",
    bn: "ধন্যবাদ {name}। এখন আপনি আপনার সমস্যা বলতে পারেন।",
    ta: "நன்றி {name}. இப்போது உங்கள் பிரச்சினையைக் கூறலாம்.",
    te: "ధన్యవాదాలు {name}. ఇప్పుడు మీ సమస్యను వివరించవచ్చు.",
    mr: "धन्यवाद {name}। आता तुम्ही तुमची तक्रार सांगू शकता.",
    gu: "આભાર {name}। હવે તમે તમારી તકલીફ જણાવી શકો છો.",
    kn: "ಧನ್ಯವಾದ {name}. ಈಗ ನೀವು ನಿಮ್ಮ ಸಮಸ್ಯೆಯನ್ನು ವಿವರಿಸಬಹುದು.",
    ml: "നന്ദി {name}. ഇപ്പോൾ നിങ്ങളുടെ പ്രശ്നം വിവരിക്കാം.",
    pa: "ਧੰਨਵਾਦ {name}। ਹੁਣ ਤੁਸੀਂ ਆਪਣੀ ਸਮੱਸਿਆ ਦੱਸ ਸਕਦੇ ਹੋ।",
  },
  thanksGuardian: {
    en: "Thank you {name}. Now you can describe the patient's problem.",
    hi: "धन्यवाद {name}। अब आप रोगी की परेशानी बता सकते हैं।",
    bn: "ধন্যবাদ {name}। এখন আপনি রোগীর সমস্যা বলতে পারেন।",
    ta: "நன்றி {name}. இப்போது நோயாளியின் பிரச்சினையைக் கூறலாம்.",
    te: "ధన్యవాదాలు {name}. ఇప్పుడు రోగి సమస్యను వివరించవచ్చు.",
    mr: "धन्यवाद {name}। आता तुम्ही रुग्णाची तक्रार सांगू शकता.",
    gu: "આભાર {name}। હવે તમે દર્દીની તકલીફ જણાવી શકો છો.",
    kn: "ಧನ್ಯವಾದ {name}. ಈಗ ನೀವು ರೋಗಿಯ ಸಮಸ್ಯೆಯನ್ನು ವಿವರಿಸಬಹುದು.",
    ml: "നന്ദി {name}. ഇപ്പോൾ രോഗിയുടെ പ്രശ്നം വിവരിക്കാം.",
    pa: "ਧੰਨਵਾਦ {name}। ਹੁਣ ਤੁਸੀਂ ਮਰੀਜ਼ ਦੀ ਸਮੱਸਿਆ ਦੱਸ ਸਕਦੇ ਹੋ।",
  },
  identifyHelp: {
    en: "Fill in name, age, department and mobile or ABHA ID, then give consent and continue.",
    hi: "नाम, उम्र, विभाग और मोबाइल या ABHA ID भरें, फिर सहमति देकर आगे बढ़ें।",
    bn: "নাম, বয়স, বিভাগ এবং মোবাইল বা ABHA ID পূরণ করুন, তারপর সম্মতি দিয়ে এগিয়ে যান।",
    ta: "பெயர், வயது, துறை, கைபேசி அல்லது ABHA எண்ணை நிரப்பி, சம்மதம் தெரிவித்துத் தொடரவும்.",
    te: "పేరు, వయస్సు, విభాగం, మొబైల్ లేదా ABHA ID నింపి, అంగీకారం ఇచ్చి కొనసాగండి.",
    mr: "नाव, वय, विभाग आणि मोबाईल किंवा ABHA ID भरा, मग संमती देऊन पुढे जा.",
    gu: "નામ, ઉંમર, વિભાગ અને મોબાઇલ અથવા ABHA ID ભરો, પછી સંમતિ આપીને આગળ વધો.",
    kn: "ಹೆಸರು, ವಯಸ್ಸು, ವಿಭಾಗ ಮತ್ತು ಮೊಬೈಲ್ ಅಥವಾ ABHA ID ಭರ್ತಿ ಮಾಡಿ, ನಂತರ ಒಪ್ಪಿಗೆ ನೀಡಿ ಮುಂದುವರಿಸಿ.",
    ml: "പേര്, പ്രായം, വകുപ്പ്, മൊബൈൽ അല്ലെങ്കിൽ ABHA ID എന്നിവ നൽകി, സമ്മതം നൽകി തുടരുക.",
    pa: "ਨਾਮ, ਉਮਰ, ਵਿਭਾਗ ਅਤੇ ਮੋਬਾਇਲ ਜਾਂ ABHA ID ਭਰੋ, ਫਿਰ ਸਹਿਮਤੀ ਦੇ ਕੇ ਅੱਗੇ ਵਧੋ।",
  },
  listenIdentify: {
    en: "State your identity and give consent.",
    hi: "अपनी पहचान बताएं और सहमति दें।",
    bn: "আপনার পরিচয় বলুন এবং সম্মতি দিন।",
    ta: "உங்கள் அடையாளத்தைக் கூறி சம்மதம் தெரிவிக்கவும்.",
    te: "మీ గుర్తింపు తెలిపి అంగీకారం ఇవ్వండి.",
    mr: "तुमची ओळख सांगा आणि संमती द्या.",
    gu: "તમારી ઓળખ જણાવો અને સંમતિ આપો.",
    kn: "ನಿಮ್ಮ ಗುರುತನ್ನು ತಿಳಿಸಿ ಒಪ್ಪಿಗೆ ನೀಡಿ.",
    ml: "നിങ്ങളുടെ തിരിച്ചറിയൽ അറിയിച്ച് സമ്മതം നൽകുക.",
    pa: "ਆਪਣੀ ਪਛਾਣ ਦੱਸੋ ਅਤੇ ਸਹਿਮਤੀ ਦਿਓ।",
  },
  listenSummary: {
    en: "Listen to your details and confirm.",
    hi: "आपकी जानकारी सुनें और पक्का करें।",
    bn: "আপনার তথ্য শুনুন এবং নিশ্চিত করুন।",
    ta: "உங்கள் விவரங்களைக் கேட்டு உறுதிப்படுத்தவும்.",
    te: "మీ వివరాలు విని నిర్ధారించండి.",
    mr: "तुमची माहिती ऐका आणि पुष्टी करा.",
    gu: "તમારી માહિતી સાંભળો અને પુષ્ટિ કરો.",
    kn: "ನಿಮ್ಮ ಮಾಹಿತಿಯನ್ನು ಕೇಳಿ ದೃಢೀಕರಿಸಿ.",
    ml: "നിങ്ങളുടെ വിവരം കേട്ട് സ്ഥിരീകരിക്കുക.",
    pa: "ਆਪਣੀ ਜਾਣਕਾਰੀ ਸੁਣੋ ਅਤੇ ਪੁਸ਼ਟੀ ਕਰੋ।",
  },
  triageCall: {
    en: "{name}, please come forward for triage.",
    hi: "{name}, कृपया ट्रायेज के लिए आगे आएं।",
    bn: "{name}, অনুগ্রহ করে ট্রায়েজের জন্য এগিয়ে আসুন।",
    ta: "{name}, தயவுசெய்து டிரயாஜ்-க்கு முன்னால் வாருங்கள்.",
    te: "{name}, దయచేసి ట్రయాజ్ కోసం ముందుకు రండి.",
    mr: "{name}, कृपया ट्रायेजसाठी पुढे या.",
    gu: "{name}, કૃપા કરીને ટ્રાયેજ માટે આગળ આવો.",
    kn: "{name}, ದಯವಿಟ್ಟು ಟ್ರಯಾಜ್‌ಗಾಗಿ ಮುಂದೆ ಬನ್ನಿ.",
    ml: "{name}, ദയവായി ട്രയാജിനായി മുന്നോട്ട് വരൂ.",
    pa: "{name}, ਕਿਰਪਾ ਕਰਕੇ ਟਰਾਇਜ ਲਈ ਅੱਗੇ ਆਓ।",
  },
  erAlert: {
    en: "Emergency! {name}, token {token}. Please proceed to Emergency immediately.",
    hi: "आपातकालीन अलर्ट! {name}, टोकन {token}। कृपया तुरंत इमरजेंसी में जाइए।",
    bn: "জরুরি! {name}, টোকন {token}। অবিলম্বে জরুরি বিভাগে যান।",
    ta: "அவசரம்! {name}, டோக்கன் {token}. உடனடியாக அவசரப் பிரிவுக்குச் செல்லவும்.",
    te: "అత్యవసరం! {name}, టోకెన్ {token}. దయచేసి వెంటనే అత్యవసర విభాగానికి వెళ్లండి.",
    mr: "आणीबाणी! {name}, टोकन {token}। कृपया ताबडतोब इमर्जन्सीत जा.",
    gu: "કટોકટી! {name}, ટોકન {token}। તાત્કાલિક ઇમરજન્સીમાં જાઓ.",
    kn: "ತುರ್ತು! {name}, ಟೋಕನ್ {token}. ದಯವಿಟ್ಟು ತಕ್ಷಣ ತುರ್ತು ವಿಭಾಗಕ್ಕೆ ಹೋಗಿ.",
    ml: "അടിയന്തരം! {name}, ടോക്കൺ {token}. ഉടൻ എമർജൻസിയിലേക്ക് പോകുക.",
    pa: "ਐਮਰਜੈਂਸੀ! {name}, ਟੋਕਨ {token}। ਕਿਰਪਾ ਕਰਕੇ ਤੁਰੰਤ ਐਮਰਜੈਂਸੀ ਵਿੱਚ ਜਾਓ।",
  },
};

export type KioskSpeechKey = keyof typeof KIOSK_SPEECH;

/** Localized kiosk phrase; `{name}`/`{token}` are interpolated from vars. */
export function kioskSpeech(key: KioskSpeechKey, langCode = "en", vars?: { name?: string; token?: string }): string {
  const table = KIOSK_SPEECH[key] ?? {};
  const template = table[langCode] ?? table[langCode.split("-")[0]] ?? table.en ?? "";
  return template.replace("{name}", vars?.name ?? "").replace("{token}", vars?.token ?? "");
}

export type RecognizerOpts = {
  /**
   * Keep listening through short pauses and stream finals until stop() — for
   * long case descriptions. Defaults to false (single utterance) so
   * command-style mics (Next/Back/Help) keep their tap-speak-done behaviour.
   */
  continuous?: boolean;
  /** Report interim (non-final) text via onInterim for live display. */
  interimResults?: boolean;
  /** Live interim text — display-only, never part of the delivered result. */
  onInterim?: (text: string) => void;
};

export function createRecognizer(lang: string, onResult: (text: string) => void, opts?: RecognizerOpts) {
  // @ts-expect-error webkit prefix
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const rec: {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    maxAlternatives: number;
    onresult: ((e: SpeechResultEvent) => void) | null;
    onerror: (() => void) | null;
    onend: (() => void) | null;
    addEventListener: (type: string, fn: (e: SpeechResultEvent) => void) => void;
    start: () => void;
    stop: () => void;
  } = new SR();
  rec.lang = lang;
  rec.continuous = opts?.continuous ?? false;
  rec.interimResults = opts?.interimResults ?? false;
  rec.maxAlternatives = 1;
  // Every final segment is collected exactly once, in order. Short pauses
  // produce interim (non-final) results only — they are previewed, never
  // stored — so long speech is never cut off and never duplicated.
  const finals: string[] = [];
  let delivered = false;
  const deliver = () => {
    if (delivered) return;
    delivered = true;
    const text = joinFinals(finals);
    if (text) onResult(text);
  };
  const accumulate = (e: SpeechResultEvent) => {
    const results = e?.results;
    if (!results) return;
    const start = typeof e.resultIndex === "number" ? e.resultIndex : 0;
    const len = typeof results.length === "number" ? results.length : 0;
    for (let i = start; i < len; i++) {
      const res = results[i];
      const transcript = res?.[0]?.transcript ?? "";
      if (!transcript) continue;
      if (res.isFinal) finals.push(transcript);
      else opts?.onInterim?.(transcript);
    }
  };
  // Wired via addEventListener — never the onresult/onend properties — so a
  // caller assigning rec.onerror/rec.onend can neither clobber accumulation
  // nor lose the delivery on automatic end.
  try {
    rec.addEventListener("result", accumulate);
    rec.addEventListener("end", () => deliver());
  } catch {
    rec.onresult = accumulate;
  }
  const origStop = rec.stop.bind(rec);
  rec.stop = () => {
    // Deliver synchronously first: callers replace onend, and some browsers
    // do not re-fire result events after stop(), which would lose everything.
    deliver();
    try {
      origStop();
    } catch {
      /* already ended — delivery above preserved the transcript */
    }
  };
  return rec;
}

/**
 * Display-only microphone level from an analyser time-domain buffer.
 * Returns 0..1 (speech typically peaks 0.1–0.5, scaled ×2 for visibility).
 * Pure so the mapping is unit-testable; not a VAD, just a level meter.
 */
export function analyserPeak(samples: ArrayLike<number>): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
  }
  return Math.min(1, peak * 2);
}

/**
 * Records audio from the microphone using MediaRecorder, then sends it to the
 * Indian ASR backend (/api/asr) when one is configured. Falls back to the Web
 * Speech API internally when no backend is available.
 *
 * `consent` carries the kiosk's pre-save ai_processing tick: the server
 * refuses backend transcription without it (403), in which case we fall back
 * to on-device speech rather than failing the voice field.
 *
 * `onLevel` receives a 0..1 mic level ~10×/second while recording (drives the
 * "speak closer" meter); omitted when the caller shows no meter.
 */
export async function recordAndTranscribe(
  lang: string,
  onTime?: (seconds: number) => void,
  maxSeconds = 60,
  consent?: ConsentState,
  onLevel?: (level: number) => void,
  onInterim?: (text: string) => void
): Promise<string> {
  if (!microphoneSupported()) {
    // No media API: use Web Speech as P2 fallback
    return transcribeViaWebSpeech(lang, maxSeconds, onInterim);
  }

  const caps = await getCapabilities();
  if (!caps?.capabilities?.asrBackend) {
    return transcribeViaWebSpeech(lang, maxSeconds, onInterim);
  }

  return new Promise<string>((resolve, reject) => {
    (async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Live level meter on the same stream (best-effort: any failure here
      // must never break recording itself).
      let audioCtx: AudioContext | null = null;
      let analyser: AnalyserNode | null = null;
      let meterTimer: ReturnType<typeof setInterval> | null = null;
      const stopMeter = () => {
        if (meterTimer) clearInterval(meterTimer);
        meterTimer = null;
        try {
          audioCtx?.close();
        } catch {
          /* ignore */
        }
        audioCtx = null;
        analyser = null;
      };
      if (onLevel) {
        try {
          audioCtx = new AudioContext();
          const source = audioCtx.createMediaStreamSource(stream);
          analyser = audioCtx.createAnalyser();
          analyser.fftSize = 512;
          source.connect(analyser);
          const buf = new Float32Array(analyser.fftSize);
          meterTimer = setInterval(() => {
            try {
              analyser?.getFloatTimeDomainData(buf);
              onLevel(analyserPeak(buf));
            } catch {
              /* ignore one bad tick */
            }
          }, 100);
        } catch {
          stopMeter();
        }
      }
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/wav";
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.onstop = async () => {
        stopMeter();
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: mime });
        const base64 = await new Promise<string>((res, rej) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const dataUrl = reader.result as string;
            const base64Data = dataUrl.split(",")[1] ?? "";
            res(base64Data);
          };
          reader.onerror = () => rej(reader.error);
          reader.readAsDataURL(blob);
        });
        try {
          const res = await fetch("/api/asr", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audioBase64: base64, language: lang, mime, consent }),
          });
          // 403 = no ai_processing scope: the audio was NOT transcribed
          // server-side. Fall back to on-device speech instead of returning
          // an empty transcript.
          if (res.status === 403) {
            resolve(await transcribeViaWebSpeech(lang, maxSeconds, onInterim));
            return;
          }
          const json = await res.json();
          resolve(json?.transcript ?? "");
        } catch (e) {
          reject(e);
        }
      };
      recorder.start(250);
      const started = Date.now();
      const timer = setInterval(() => onTime?.((Date.now() - started) / 1000), 500);
      const finish = () => {
        clearInterval(timer);
        window.removeEventListener("speechrecord:stop", finish);
        if (recorder.state !== "inactive") recorder.stop();
      };
      setTimeout(finish, maxSeconds * 1000);

      window.addEventListener("speechrecord:stop", finish, { once: true });
    })().catch(reject);
  });
}

function transcribeViaWebSpeech(lang: string, maxSeconds = 60, onInterim?: (text: string) => void): Promise<string> {
  if (!speechSupported()) return Promise.resolve("");
  return new Promise((resolve) => {
    let done = false;
    const finish = (text: string) => {
      if (done) return;
      done = true;
      cleanup();
      resolve(text);
    };
    // Continuous dictation: short pauses yield interim results only, finals
    // keep accumulating until the user taps stop, the session auto-ends, or
    // the time budget runs out. Partial finals always survive auto-end/error.
    const rec = createRecognizer(lang, (text) => finish(text), {
      continuous: true,
      interimResults: true,
      ...(onInterim ? { onInterim } : {}),
    });
    if (!rec) {
      resolve("");
      return;
    }
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener("speechrecord:stop", stopNow);
    };
    // Second mic tap: rec.stop() flushes accumulated finals synchronously
    // through onResult → finish. If nothing was heard yet, resolve "" shortly
    // after so the UI recovers instead of hanging in "recording".
    const stopNow = () => {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
      window.setTimeout(() => finish(""), 600);
    };
    const timer = window.setTimeout(stopNow, Math.max(maxSeconds, 5) * 1000);
    window.addEventListener("speechrecord:stop", stopNow, { once: true });
    // Auto-end or recognition error with partial capture: the recognizer's
    // own "end" listener already delivered any finals via onResult → finish.
    // Whatever reaches here heard nothing usable — resolve "" so callers can
    // show the "couldn't hear" hint instead of hanging.
    rec.onerror = () => {};
    rec.onend = () => {
      window.setTimeout(() => finish(""), 300);
    };
    try {
      rec.start();
    } catch {
      finish("");
    }
  });
}