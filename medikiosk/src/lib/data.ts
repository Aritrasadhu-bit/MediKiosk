import type { Language, Question } from "./types";
import type { IconName } from "@/components/Icon";

export const LANGUAGES: Language[] = [
  { code: "hi", name: "Hindi", native: "हिन्दी", voiceCode: "hi-IN" },
  { code: "en", name: "English", native: "English", voiceCode: "en-IN" },
  { code: "bn", name: "Bengali", native: "বাংলা", voiceCode: "bn-IN" },
  { code: "ta", name: "Tamil", native: "தமிழ்", voiceCode: "ta-IN" },
  { code: "te", name: "Telugu", native: "తెలుగు", voiceCode: "te-IN" },
  { code: "mr", name: "Marathi", native: "मराठी", voiceCode: "mr-IN" },
  { code: "gu", name: "Gujarati", native: "ગુજરાતી", voiceCode: "gu-IN" },
  { code: "kn", name: "Kannada", native: "ಕನ್ನಡ", voiceCode: "kn-IN" },
  { code: "ml", name: "Malayalam", native: "മലയാളം", voiceCode: "ml-IN" },
  { code: "pa", name: "Punjabi", native: "ਪੰਜਾਬੀ", voiceCode: "pa-IN" },
];

export const DEPARTMENTS = [
  "General Medicine",
  "Cardiology",
  "Neurology",
  "Pulmonology",
  "Gastroenterology",
  "Nephrology",
  "Endocrinology",
  "Orthopaedics",
  "Dermatology",
  "ENT",
  "Ophthalmology",
  "Gynaecology & Obstetrics",
  "Paediatrics",
  "Psychiatry",
  "Surgery",
  "Dentistry",
  "AYUSH - Ayurveda (General)",
  "AYUSH - Panchakarma",
  "AYUSH - Yoga & Naturopathy",
];

export const CHIEF_COMPLAINTS: { label: string; icon: IconName }[] = [
  { label: "Chest Pain", icon: "activity" },
  { label: "Fever", icon: "droplet" },
  { label: "Headache", icon: "brain" },
  { label: "Cough", icon: "stethoscopeLine" },
  { label: "Breathlessness", icon: "trending" },
  { label: "Abdominal Pain", icon: "bandage" },
  { label: "Weakness / Fatigue", icon: "droplet" },
  { label: "Vomiting / Nausea", icon: "refresh" },
  { label: "Dizziness", icon: "refresh" },
  { label: "Joint / Body Pain", icon: "stethoscopeLine" },
  { label: "Skin Rash", icon: "bandage" },
  { label: "Urinary Problem", icon: "droplet" },
  { label: "Diabetes / BP", icon: "activity" },
  { label: "Sore Throat", icon: "stethoscopeLine" },
  { label: "Cold & Sneezing", icon: "droplet" },
  { label: "Loose Motions", icon: "droplet" },
  { label: "Constipation", icon: "refresh" },
  { label: "Back Pain", icon: "activity" },
  { label: "Tooth Pain", icon: "plus" },
  { label: "Eye Problem", icon: "search" },
  { label: "Ear Pain", icon: "bell" },
  { label: "Injury / Wound", icon: "bandage" },
  { label: "Swelling", icon: "trending" },
  { label: "Other", icon: "plus" },
];

export const SOCRATES: Question[] = [
  {
    id: "onset",
    category: "HPI - SOCRATES",
    text: "When did this problem start?",
    type: "options",
    options: [
      "Today",
      "1-3 days ago",
      "About a week ago",
      "2-4 weeks ago",
      "More than a month ago",
      "Long-standing / years",
    ],
  },
  {
    id: "character",
    category: "HPI - SOCRATES",
    text: "How would you describe the feeling?",
    type: "options",
    options: [
      "Dull / aching",
      "Sharp / stabbing",
      "Burning",
      "Tightness / pressure",
      "Throbbing",
      "Cramping",
      "Not sure",
    ],
  },
  {
    id: "radiation",
    category: "HPI - SOCRATES",
    text: "Does it spread anywhere else?",
    type: "options",
    options: [
      "No, stays in one place",
      "Arm / shoulder",
      "Neck / jaw",
      "Back",
      "Not sure",
    ],
  },
  {
    id: "severity",
    category: "HPI - SOCRATES",
    text: "On a scale of 0 to 10, how severe is it (0 = none, 10 = worst)?",
    type: "options",
    options: ["1-3 (Mild)", "4-6 (Moderate)", "7-8 (Severe)", "9-10 (Worst possible)"],
  },
  {
    id: "timing",
    category: "HPI - SOCRATES",
    text: "Is it constant or does it come and go?",
    type: "options",
    options: ["Constant", "Comes and goes", "Worse at night", "Worse in the morning", "No pattern"],
  },
  {
    id: "aggravating",
    category: "HPI - SOCRATES",
    text: "What makes it worse?",
    type: "options",
    options: ["Movement / activity", "Eating", "Stress", "Lying down", "Nothing", "Not sure"],
  },
  {
    id: "relieving",
    category: "HPI - SOCRATES",
    text: "What makes it better?",
    type: "options",
    options: ["Rest", "Medication", "Eating", "Posture", "Nothing", "Not sure"],
  },
];

export const CARDIOLOGY_QUESTIONS: Question[] = [
  {
    id: "onset",
    category: "Cardiology HPI",
    text: "When did this chest or heart problem start?",
    type: "options",
    options: ["Suddenly today", "1-3 days ago", "About a week ago", "Few weeks ago", "Months / long-standing"],
  },
  {
    id: "character",
    category: "Cardiology HPI",
    text: "How does the chest feeling or pain feel?",
    type: "options",
    options: ["Heavy tightness / pressure", "Crushing / squeezing", "Sharp / catching with breath", "Burning / indigestion-like", "Fluttering / palpitation"],
  },
  {
    id: "cardio_exertion",
    category: "Cardiology HPI",
    text: "Does the discomfort increase with walking, climbing stairs, or exertion?",
    type: "options",
    options: ["Yes, increases with walking/stairs", "Occurs even at complete rest", "Occurs only during heavy exertion", "No relation to exertion"],
  },
  {
    id: "radiation",
    category: "Cardiology HPI",
    text: "Does the discomfort spread anywhere else?",
    type: "options",
    options: ["No, stays in center of chest", "Left arm / shoulder", "Neck / jaw / throat", "Back / shoulder blades", "Upper abdomen"],
  },
  {
    id: "cardio_associated",
    category: "Cardiology HPI",
    text: "Are you experiencing any of these associated symptoms?",
    type: "options",
    options: ["None of these", "Palpitations / racing heartbeat", "Cold sweating & dizziness", "Breathlessness when lying flat", "Swelling in feet / ankles"],
  },
  {
    id: "severity",
    category: "Cardiology HPI",
    text: "On a scale of 0 to 10, how severe is the symptom?",
    type: "options",
    options: ["1-3 (Mild)", "4-6 (Moderate)", "7-8 (Severe)", "9-10 (Worst possible)"],
  },
  {
    id: "relieving",
    category: "Cardiology HPI",
    text: "What gives you relief?",
    type: "options",
    options: ["Rest / sitting still", "Sorbitrate / medication", "Deep breathing / fresh air", "Nothing gives relief", "Not sure"],
  },
];

export const ORTHOPAEDICS_QUESTIONS: Question[] = [
  {
    id: "onset",
    category: "Orthopaedics HPI",
    text: "When did this bone or joint pain start?",
    type: "options",
    options: ["Today", "1-3 days ago", "About a week ago", "2-4 weeks ago", "More than a month ago", "Years / chronic"],
  },
  {
    id: "ortho_weight_bearing",
    category: "Orthopaedics HPI",
    text: "Can you put weight on the limb or walk comfortably?",
    type: "options",
    options: ["Yes, walking normally", "Can walk with pain / limp", "Cannot bear weight / need support", "Completely unable to move limb"],
  },
  {
    id: "ortho_joint_symptoms",
    category: "Orthopaedics HPI",
    text: "Are you having joint swelling, stiffness, or locking?",
    type: "options",
    options: ["No swelling or locking", "Morning stiffness (>30 mins)", "Visible swelling & warmth", "Joint clicking / catching", "Joint feels unstable / gives way"],
  },
  {
    id: "ortho_trauma",
    category: "Orthopaedics HPI",
    text: "Was there a recent fall, twist, or injury?",
    type: "options",
    options: ["No injury / started gradually", "Recent fall or slip", "Twisting / sports injury", "Lifting heavy weight", "Road accident"],
  },
  {
    id: "severity",
    category: "Orthopaedics HPI",
    text: "On a scale of 0 to 10, how severe is the pain?",
    type: "options",
    options: ["1-3 (Mild)", "4-6 (Moderate)", "7-8 (Severe)", "9-10 (Worst possible)"],
  },
  {
    id: "aggravating",
    category: "Orthopaedics HPI",
    text: "What makes the pain worse?",
    type: "options",
    options: ["Walking / climbing stairs", "Bending / squatting", "Standing for long", "Lifting weights", "Cold weather", "Nothing specific"],
  },
  {
    id: "relieving",
    category: "Orthopaedics HPI",
    text: "What helps relieve the pain?",
    type: "options",
    options: ["Rest / lying down", "Painkiller tablets / spray", "Hot / cold pack", "Massage / support bandage", "Nothing helps"],
  },
];

export const DERMATOLOGY_QUESTIONS: Question[] = [
  {
    id: "onset",
    category: "Dermatology HPI",
    text: "When did this skin problem first appear?",
    type: "options",
    options: ["Today / sudden", "1-3 days ago", "About a week ago", "2-4 weeks ago", "Months ago / recurrent"],
  },
  {
    id: "derm_sensation",
    category: "Dermatology HPI",
    text: "How does the affected skin area feel?",
    type: "options",
    options: ["Severe itching (pruritus)", "Burning / stinging sensation", "Painful / tender to touch", "Dry / tight sensation", "No itching or pain"],
  },
  {
    id: "derm_appearance",
    category: "Dermatology HPI",
    text: "What does the skin rash or lesion look like?",
    type: "options",
    options: ["Red itchy patches / welts", "Tiny bumps / acne-like pimples", "Water blisters (vesicles) / peeling", "Dry scaly / flaky patches", "Dark or white patches", "Pus-filled boils"],
  },
  {
    id: "derm_triggers",
    category: "Dermatology HPI",
    text: "Did this start after exposure to any possible trigger?",
    type: "options",
    options: ["No known trigger", "New soap, cream, or hair dye", "Sunlight / heat exposure", "New medication / antibiotics", "Insect bite / plant contact", "Specific food item"],
  },
  {
    id: "timing",
    category: "Dermatology HPI",
    text: "Is it spreading or changing over time?",
    type: "options",
    options: ["Staying in one spot", "Spreading to other body areas", "Worse at night", "Worse in summer / sweating", "Comes and goes"],
  },
  {
    id: "relieving",
    category: "Dermatology HPI",
    text: "Have you applied any cream or taken any medicines?",
    type: "options",
    options: ["Nothing applied yet", "Moisturizer / coconut oil", "Steroid / antifungal tube", "Antihistamine / allergy tablet", "Home remedies / herbs"],
  },
];

export const ENT_QUESTIONS: Question[] = [
  {
    id: "onset",
    category: "ENT HPI",
    text: "When did this ear, nose, or throat issue start?",
    type: "options",
    options: ["Today", "1-3 days ago", "About a week ago", "2-4 weeks ago", "Long-standing / months"],
  },
  {
    id: "ent_discharge",
    category: "ENT HPI",
    text: "Is there any discharge from your ears or nose?",
    type: "options",
    options: ["No discharge", "Clear watery runny nose", "Thick yellow / green pus discharge", "Foul-smelling ear fluid", "Blood in nasal discharge / nosebleed"],
  },
  {
    id: "ent_ear_throat",
    category: "ENT HPI",
    text: "Are you experiencing any of these specific symptoms?",
    type: "options",
    options: ["None of these", "Reduced hearing / blocked ear sensation", "Ringing sound (tinnitus) / spinning head (vertigo)", "Severe sore throat / pain swallowing", "Voice hoarseness / loss of voice", "Nasal congestion & facial heaviness"],
  },
  {
    id: "severity",
    category: "ENT HPI",
    text: "On a scale of 0 to 10, how severe is your discomfort?",
    type: "options",
    options: ["1-3 (Mild)", "4-6 (Moderate)", "7-8 (Severe)", "9-10 (Worst possible)"],
  },
  {
    id: "relieving",
    category: "ENT HPI",
    text: "What brings you relief?",
    type: "options",
    options: ["Steam inhalation / warm saline gargle", "Nasal drops / ear drops", "Antibiotics / pain medicine", "Rest", "Nothing helps"],
  },
];

export const OPHTHALMOLOGY_QUESTIONS: Question[] = [
  {
    id: "onset",
    category: "Ophthalmology HPI",
    text: "When did this eye problem start?",
    type: "options",
    options: ["Sudden onset today", "1-3 days ago", "About a week ago", "Gradually over months", "Long-standing vision change"],
  },
  {
    id: "eye_vision",
    category: "Ophthalmology HPI",
    text: "Have you noticed any change in your vision?",
    type: "options",
    options: ["Vision is normal", "Blurry vision in one eye", "Blurry vision in both eyes", "Seeing halos / colored rings around lights", "Black spots / floaters / flashes", "Sudden vision loss"],
  },
  {
    id: "eye_symptoms",
    category: "Ophthalmology HPI",
    text: "Are you having eye redness, pain, discharge, or irritation?",
    type: "options",
    options: ["No pain or redness", "Redness and watery eyes", "Gritty / foreign body sensation", "Severe throbbing eye pain", "Yellow pus discharge / crusted lids", "Sensitivity to bright light (photophobia)"],
  },
  {
    id: "severity",
    category: "Ophthalmology HPI",
    text: "On a scale of 0 to 10, how severe is your eye discomfort?",
    type: "options",
    options: ["1-3 (Mild)", "4-6 (Moderate)", "7-8 (Severe)", "9-10 (Worst possible)"],
  },
];

export const PAEDIATRICS_QUESTIONS: Question[] = [
  {
    id: "onset",
    category: "Paediatrics HPI",
    text: "When did the child's illness start?",
    type: "options",
    options: ["Today", "1-2 days ago", "3-5 days ago", "About a week ago", "More than a week ago"],
  },
  {
    id: "paed_feeding",
    category: "Paediatrics HPI",
    text: "How is the child's feeding and fluid intake?",
    type: "options",
    options: ["Normal feeding & drinking", "Reduced intake / eating less", "Refusing feeds completely", "Vomiting whatever is given"],
  },
  {
    id: "paed_activity",
    category: "Paediatrics HPI",
    text: "How is the child's activity and alertness level?",
    type: "options",
    options: ["Active and playful as usual", "Tired / wants to sleep more", "Excessive crying / inconsolable", "Unusually drowsy / hard to wake up"],
  },
  {
    id: "paed_fever_associated",
    category: "Paediatrics HPI",
    text: "Are there any of these associated symptoms in the child?",
    type: "options",
    options: ["None", "Fast breathing / chest indrawing", "Loose watery stools / diarrhea", "Skin rash / reddish spots", "Ear pulling / constant fussiness", "High fever with shivering"],
  },
  {
    id: "severity",
    category: "Paediatrics HPI",
    text: "How severe does the child's condition seem right now?",
    type: "options",
    options: ["Mild / manageable at home", "Moderate / needs doctor today", "Severe / very weak", "Emergency / very unwell"],
  },
];

export const GYNAECOLOGY_QUESTIONS: Question[] = [
  {
    id: "onset",
    category: "Gynaecology HPI",
    text: "When did this symptom or problem start?",
    type: "options",
    options: ["Today / few days ago", "With the current period", "1-2 months ago", "Long-standing / chronic", "After childbirth / procedure"],
  },
  {
    id: "gyn_period",
    category: "Gynaecology HPI",
    text: "How are your menstrual cycles and last period (LMP)?",
    type: "options",
    options: ["Normal & regular monthly cycles", "Missed / delayed period (LMP late)", "Heavy flow with blood clots", "Irregular / frequent bleeding", "Severe painful periods (dysmenorrhea)", "Menopause (periods stopped)"],
  },
  {
    id: "gyn_symptoms",
    category: "Gynaecology HPI",
    text: "Are you having pelvic pain, unusual discharge, or possibility of pregnancy?",
    type: "options",
    options: ["None of these", "Lower abdominal / pelvic cramp", "White / foul-smelling vaginal discharge", "Itching or burning in intimate area", "Chance of current pregnancy", "Pain during urination"],
  },
  {
    id: "severity",
    category: "Gynaecology HPI",
    text: "On a scale of 0 to 10, how severe is your pain or discomfort?",
    type: "options",
    options: ["1-3 (Mild)", "4-6 (Moderate)", "7-8 (Severe)", "9-10 (Worst possible)"],
  },
];

export const NEUROLOGY_QUESTIONS: Question[] = [
  {
    id: "onset",
    category: "Neurology HPI",
    text: "When did this neurological symptom start?",
    type: "options",
    options: ["Sudden (within minutes/hours)", "1-3 days ago", "About a week ago", "Few weeks ago", "Months / years"],
  },
  {
    id: "neuro_location",
    category: "Neurology HPI",
    text: "Where are you experiencing the weakness, numbness, or pain?",
    type: "options",
    options: ["Head / forehead / neck", "One side of the body (arm & leg)", "Both hands or feet (gloves/stockings)", "Face drooping / speech difficulty", "Generalized whole body"],
  },
  {
    id: "neuro_type",
    category: "Neurology HPI",
    text: "Which of these symptoms describes what you feel?",
    type: "options",
    options: ["Throbbing headache / migraine aura", "Tingling / numbness / pins & needles", "Tremors / hand shaking", "Loss of balance / unsteady walking", "Loss of consciousness / seizure / blackout episode", "Memory issues / confusion"],
  },
  {
    id: "severity",
    category: "Neurology HPI",
    text: "On a scale of 0 to 10, how severe is the symptom?",
    type: "options",
    options: ["1-3 (Mild)", "4-6 (Moderate)", "7-8 (Severe)", "9-10 (Worst possible)"],
  },
];

export const PULMONOLOGY_QUESTIONS: Question[] = [
  {
    id: "onset",
    category: "Pulmonology HPI",
    text: "When did this cough or breathing trouble start?",
    type: "options",
    options: ["1-3 days ago", "About a week ago", "2-4 weeks ago", "More than a month ago", "Chronic / recurrent since years"],
  },
  {
    id: "pulmo_cough",
    category: "Pulmonology HPI",
    text: "What kind of cough or sputum do you have?",
    type: "options",
    options: ["Dry irritating cough", "Cough with clear / white phlegm", "Cough with yellow / greenish phlegm", "Cough with blood streaks (hemoptysis)", "No cough, only breathlessness", "Wheezing / whistling sound in chest"],
  },
  {
    id: "pulmo_triggers",
    category: "Pulmonology HPI",
    text: "What makes your breathing worse?",
    type: "options",
    options: ["Walking / climbing stairs", "Cold air / dust / smoke exposure", "Lying down flat at night", "Physical exercise", "Nothing specific"],
  },
  {
    id: "severity",
    category: "Pulmonology HPI",
    text: "On a scale of 0 to 10, how severe is your breathing difficulty?",
    type: "options",
    options: ["1-3 (Mild)", "4-6 (Moderate)", "7-8 (Severe)", "9-10 (Worst possible)"],
  },
];

export const GASTROENTEROLOGY_QUESTIONS: Question[] = [
  {
    id: "onset",
    category: "Gastroenterology HPI",
    text: "When did this digestive or stomach problem start?",
    type: "options",
    options: ["Today", "1-3 days ago", "About a week ago", "2-4 weeks ago", "Months / long-standing"],
  },
  {
    id: "gi_meals",
    category: "Gastroenterology HPI",
    text: "How is the abdominal discomfort related to eating?",
    type: "options",
    options: ["Worse immediately after meals", "Better after eating / empty stomach pain", "Heartburn / sour acid regurgitation", "No relation to food intake"],
  },
  {
    id: "gi_bowel",
    category: "Gastroenterology HPI",
    text: "Have you noticed any change in your bowel movements or stool?",
    type: "options",
    options: ["Normal regular stool", "Watery diarrhea / loose motions", "Severe constipation / hard stool", "Nausea & vomiting", "Blood in stool / black tarry stool", "Yellow eyes or dark urine (jaundice)"],
  },
  {
    id: "severity",
    category: "Gastroenterology HPI",
    text: "On a scale of 0 to 10, how severe is your abdominal discomfort?",
    type: "options",
    options: ["1-3 (Mild)", "4-6 (Moderate)", "7-8 (Severe)", "9-10 (Worst possible)"],
  },
];

export const NEPHROLOGY_QUESTIONS: Question[] = [
  {
    id: "onset",
    category: "Nephrology HPI",
    text: "When did this urinary or kidney symptom start?",
    type: "options",
    options: ["Today", "1-3 days ago", "About a week ago", "2-4 weeks ago", "Months / chronic"],
  },
  {
    id: "uro_urination",
    category: "Nephrology HPI",
    text: "Are you having any problems while passing urine?",
    type: "options",
    options: ["Normal urination", "Burning sensation / pain while urinating", "Frequent urination / waking up at night", "Difficulty starting / weak urine stream", "Reddish / blood-tinged / dark urine", "Very low urine output"],
  },
  {
    id: "uro_swelling",
    category: "Nephrology HPI",
    text: "Have you noticed any swelling or back/flank pain?",
    type: "options",
    options: ["No swelling or back pain", "Morning swelling around eyes & face", "Swelling in both feet / ankles", "Sharp pain in lower back / flank", "Fever with chills and urinary burning"],
  },
  {
    id: "severity",
    category: "Nephrology HPI",
    text: "On a scale of 0 to 10, how severe is the discomfort?",
    type: "options",
    options: ["1-3 (Mild)", "4-6 (Moderate)", "7-8 (Severe)", "9-10 (Worst possible)"],
  },
];

export const AYUSH_HPI_QUESTIONS: Question[] = [
  {
    id: "onset",
    category: "AYUSH HPI",
    text: "When did your main health complaint begin?",
    type: "options",
    options: ["Recently (few days ago)", "1-2 weeks ago", "1-3 months ago", "More than 6 months ago", "Chronic / recurring since years"],
  },
  {
    id: "agni",
    category: "AYUSH HPI",
    text: "How is your appetite (Agni) and digestion after meals?",
    type: "options",
    options: [
      "Good appetite & easy digestion (Sama Agni)",
      "Irregular appetite, gas & bloating (Visham Agni - Vata)",
      "Excessive hunger, acidity & burning (Tikshna Agni - Pitta)",
      "Poor appetite, heaviness & slow digestion (Manda Agni - Kapha)",
    ],
  },
  {
    id: "koshtha",
    category: "AYUSH HPI",
    text: "What is the nature of your bowel habits (Koshtha)?",
    type: "options",
    options: [
      "Normal & regular daily (Madhyama)",
      "Dry, hard stool & constipation (Krura - Vata)",
      "Loose, frequent & quick movement (Mridu - Pitta)",
      "Heavy, sticky stool with mucus (Kapha)",
    ],
  },
  {
    id: "ayush_thermal",
    category: "AYUSH HPI",
    text: "What climate or drinks suit your body best (Sheet / Ushna)?",
    type: "options",
    options: [
      "Prefer warm weather & warm drinks (sensitive to cold)",
      "Prefer cool weather & cold drinks (sensitive to heat/sweat)",
      "Comfortable in both warm and cool conditions",
      "Not sure",
    ],
  },
  {
    id: "severity",
    category: "AYUSH HPI",
    text: "On a scale of 0 to 10, how much does this disturbance affect your daily life?",
    type: "options",
    options: ["1-3 (Mild)", "4-6 (Moderate)", "7-8 (Severe)", "9-10 (Severe distress)"],
  },
];

export const ENDOCRINOLOGY_QUESTIONS: Question[] = [
  {
    id: "onset",
    category: "Endocrinology HPI",
    text: "When did you first notice these symptoms or sugar/thyroid issues?",
    type: "options",
    options: ["Recently (days/weeks)", "Few months ago", "1-2 years ago", "Long-standing / chronic"],
  },
  {
    id: "endo_symptoms",
    category: "Endocrinology HPI",
    text: "Are you experiencing excessive thirst, frequent urination, or sudden weight change?",
    type: "options",
    options: [
      "Excessive thirst & frequent urination",
      "Sudden unexplained weight loss",
      "Unexplained weight gain & fatigue",
      "Heat or cold intolerance",
      "None of these",
    ],
  },
  {
    id: "endo_energy",
    category: "Endocrinology HPI",
    text: "Are you having hand tremors, palpitations, extreme fatigue, or neck swelling?",
    type: "options",
    options: [
      "None of these",
      "Hand tremors & anxiety",
      "Palpitations & excessive sweating",
      "Extreme tiredness / lethargy",
      "Swelling in front of neck (goiter)",
    ],
  },
  {
    id: "severity",
    category: "Endocrinology HPI",
    text: "On a scale of 0 to 10, how severe is your fatigue or discomfort?",
    type: "options",
    options: ["1-3 (Mild)", "4-6 (Moderate)", "7-8 (Severe)", "9-10 (Worst possible)"],
  },
];

export const PSYCHIATRY_QUESTIONS: Question[] = [
  {
    id: "onset",
    category: "Psychiatry HPI",
    text: "When did these mood, anxiety, or sleep disturbances begin?",
    type: "options",
    options: ["Few days ago (acute stress)", "2-4 weeks ago", "1-6 months ago", "Long-standing / chronic"],
  },
  {
    id: "psych_mood",
    category: "Psychiatry HPI",
    text: "How has your mood, interest in daily activities, or anxiety level been?",
    type: "options",
    options: [
      "Low mood / feeling hopeless or sad",
      "Loss of interest in all activities (anhedonia)",
      "Excessive worry / anxiety / panic episodes",
      "Rapid mood swings / restlessness",
      "Fairly normal mood",
    ],
  },
  {
    id: "psych_sleep",
    category: "Psychiatry HPI",
    text: "How is your sleep and appetite currently?",
    type: "options",
    options: [
      "Difficulty falling asleep (insomnia)",
      "Waking up very early / broken sleep",
      "Excessive sleeping & exhaustion",
      "Loss of appetite or overeating",
      "Normal sleep & appetite",
    ],
  },
  {
    id: "severity",
    category: "Psychiatry HPI",
    text: "How much is this distress affecting your daily life and work?",
    type: "options",
    options: ["1-3 (Mild / manageable)", "4-6 (Moderate / difficult)", "7-8 (Severe / hard to function)", "9-10 (Severe distress)"],
  },
];

export const SURGERY_QUESTIONS: Question[] = [
  {
    id: "onset",
    category: "Surgery HPI",
    text: "When did this swelling, lump, wound, or abdominal pain start?",
    type: "options",
    options: ["Sudden onset today", "1-3 days ago", "About a week ago", "Few weeks ago", "Months / years ago"],
  },
  {
    id: "surg_swelling",
    category: "Surgery HPI",
    text: "If you have a lump, swelling, or wound, how has it changed?",
    type: "options",
    options: [
      "No lump or wound",
      "Lump is rapidly growing in size",
      "Lump is painful & tender to touch",
      "Swelling disappears when lying down (hernia)",
      "Wound/ulcer with pus discharge or bleeding",
    ],
  },
  {
    id: "surg_abdomen",
    category: "Surgery HPI",
    text: "Are you having severe abdominal pain, vomiting, or inability to pass gas/stool?",
    type: "options",
    options: [
      "None of these",
      "Severe sharp abdominal pain",
      "Repeated vomiting with stomach distension",
      "Unable to pass gas or stool (obstruction)",
      "Bleeding with bowel movements",
    ],
  },
  {
    id: "severity",
    category: "Surgery HPI",
    text: "On a scale of 0 to 10, how severe is your pain or discomfort?",
    type: "options",
    options: ["1-3 (Mild)", "4-6 (Moderate)", "7-8 (Severe)", "9-10 (Worst possible)"],
  },
];

export const DENTISTRY_QUESTIONS: Question[] = [
  {
    id: "onset",
    category: "Dentistry HPI",
    text: "When did this tooth, gum, or jaw pain start?",
    type: "options",
    options: ["Today / sudden", "1-3 days ago", "About a week ago", "2-4 weeks ago", "Months / chronic"],
  },
  {
    id: "dental_sensitivity",
    category: "Dentistry HPI",
    text: "Is there sharp sensitivity or pain with hot, cold, or sweet foods?",
    type: "options",
    options: [
      "No sensitivity",
      "Sharp pain with cold water/food",
      "Pain with hot liquids / tea",
      "Sensitivity with sweets",
      "Severe throbbing pain while chewing/biting",
    ],
  },
  {
    id: "dental_swelling",
    category: "Dentistry HPI",
    text: "Do you have gum swelling, bleeding, or difficulty opening your mouth?",
    type: "options",
    options: [
      "None of these",
      "Swollen, painful, or bleeding gums",
      "Pus discharge / boil near tooth (abscess)",
      "Facial swelling near jaw",
      "Difficulty opening mouth or chewing (trismus)",
    ],
  },
  {
    id: "severity",
    category: "Dentistry HPI",
    text: "On a scale of 0 to 10, how severe is your tooth or jaw pain?",
    type: "options",
    options: ["1-3 (Mild)", "4-6 (Moderate)", "7-8 (Severe)", "9-10 (Worst possible)"],
  },
];

/**
 * Returns the clinically specialized question set tailored to the patient's
 * selected OPD department. Falls back to standard SOCRATES for General Medicine
 * or unlisted departments.
 */
export function getDepartmentQuestions(department?: string, mode?: string): Question[] {
  if (mode === "ayush" || (department && department.toLowerCase().includes("ayush"))) {
    return AYUSH_HPI_QUESTIONS;
  }
  const dept = (department || "").toLowerCase().trim();
  if (dept.includes("gastro") || dept.includes("digest") || dept.includes("stomach") || dept.includes("liver")) return GASTROENTEROLOGY_QUESTIONS;
  if (dept.includes("cardio") || dept.includes("heart")) return CARDIOLOGY_QUESTIONS;
  if (dept.includes("ortho") || dept.includes("bone") || dept.includes("joint")) return ORTHOPAEDICS_QUESTIONS;
  if (dept.includes("derma") || dept.includes("skin")) return DERMATOLOGY_QUESTIONS;
  if (/\bent\b/.test(dept) || dept.includes("ear") || dept.includes("nose") || dept.includes("throat") || dept.includes("otorhino")) return ENT_QUESTIONS;
  if (dept.includes("ophthal") || dept.includes("eye")) return OPHTHALMOLOGY_QUESTIONS;
  if (dept.includes("paed") || dept.includes("ped") || dept.includes("child")) return PAEDIATRICS_QUESTIONS;
  if (dept.includes("gyn") || dept.includes("obs") || dept.includes("women")) return GYNAECOLOGY_QUESTIONS;
  if (dept.includes("neuro") || dept.includes("brain") || dept.includes("nerve")) return NEUROLOGY_QUESTIONS;
  if (dept.includes("pulmo") || dept.includes("chest") || dept.includes("resp") || dept.includes("lung")) return PULMONOLOGY_QUESTIONS;
  if (dept.includes("nephro") || dept.includes("urolog") || /\buro\b/.test(dept) || dept.includes("kidney") || dept.includes("urinary")) return NEPHROLOGY_QUESTIONS;
  if (dept.includes("endo") || dept.includes("diabet") || dept.includes("thyroid")) return ENDOCRINOLOGY_QUESTIONS;
  if (dept.includes("psych") || dept.includes("mental") || dept.includes("mind")) return PSYCHIATRY_QUESTIONS;
  if (dept.includes("surg") || dept.includes("wound") || dept.includes("hernia")) return SURGERY_QUESTIONS;
  if (dept.includes("dent") || dept.includes("tooth") || dept.includes("teeth") || dept.includes("oral")) return DENTISTRY_QUESTIONS;
  return SOCRATES;
}

export const REGULAR_QUESTIONS: Question[] = [
  {
    id: "hpi",
    category: "HPI - Reason for visit",
    text: "Please tell me more about what happened. Can you describe what you are feeling in your own words?",
    type: "text",
  },
];

export const DASHAVIDHA_PARIKsha_BASE = [
  {
    param: "Prakriti",
    meaning: "Constitution",
    note: "Born body type (Vata / Pitta / Kapha dominant)",
  },
  {
    param: "Vikriti",
    meaning: "Current imbalance",
    note: "How the body is disturbed now",
  },
  {
    param: "Sara",
    meaning: "Tissue excellence",
    note: "Strength of essential tissues (bala, skin, voice)",
  },
  {
    param: "Samhanana",
    meaning: "Body compactness",
    note: "Bone-joint and body build quality",
  },
  {
    param: "Pramana",
    meaning: "Body measurements",
    note: "Height, weight, proportions",
  },
  {
    param: "Satmya",
    meaning: "Wholesome compatibility",
    note: "Habits that suit the person (food, climate)",
  },
  {
    param: "Sattva",
    meaning: "Mental constitution",
    note: "Mind set, courage, memory, emotions",
  },
  {
    param: "Ahara Shakti",
    meaning: "Digestive & intake capacity",
    note: "Agnibal (appetite & digestion strength)",
  },
  {
    param: "Vyayama Shakti",
    meaning: "Exercise capacity",
    note: "Endurance & physical work capacity",
  },
  {
    param: "Vaya",
    meaning: "Age",
    note: "Stage of life (Bal, Yuvak, Vriddha)",
  },
];

export const AYUSH_FOLLOWUPS: Question[] = [
  {
    id: "agni",
    category: "AYUSH - Agni & Koshtha",
    text: "How is your digestion / appetite?",
    type: "options",
    options: [
      "Good - strong appetite",
      "Normal",
      "Irregular / sluggish",
      "Poor appetite",
      "Excessive hunger",
    ],
  },
  {
    id: "koshtha",
    category: "AYUSH - Agni & Koshtha",
    text: "What is your bowel nature?",
    type: "options",
    options: [
      "Regular daily",
      "Constipated",
      "Loose / frequent",
      "Alternating",
      "Hard, difficult",
    ],
  },
  {
    id: "prakriti",
    category: "AYUSH - Prakriti",
    text: "What body type were you born with? (Prakriti)",
    type: "options",
    options: [
      "Vata (thin, dry, active)",
      "Pitta (medium, warm, sharp)",
      "Kapha (solid, cool, calm)",
      "Vata-Pitta",
      "Pitta-Kapha",
      "Vata-Kapha",
      "Balanced (Sama)",
      "Not sure",
    ],
  },
  {
    id: "vaya",
    category: "AYUSH - Prakriti",
    text: "What is your stage of life?",
    type: "options",
    options: ["Childhood (Bal)", "Young adult (Yuvak)", "Middle age", "Elderly (Vriddha)"],
  },
  {
    id: "sattva",
    category: "AYUSH - Satva",
    text: "How is your mind generally?",
    type: "options",
    options: [
      "Calm and steady",
      "Anxious / restless",
      "Irritable / angry",
      "Low mood",
      "Fearful",
      "Good memory and courage",
    ],
  },
  {
    id: "vihara",
    category: "AYUSH - Ahara Vihara",
    text: "Can you describe your daily routine, food and sleep?",
    type: "text",
  },
];
