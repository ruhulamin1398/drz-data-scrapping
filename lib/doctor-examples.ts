// Few-shot gold examples for the doctor extraction prompt (verified outputs).
// Inputs are full Jina profile markdowns; outputs are the exact expected JSON.
export type DoctorExample = { label: string; specialty: string; deptName: string; card: string; input: string; output: unknown };

export const DOCTOR_EXAMPLES: DoctorExample[] = [
 {
  "label": "Male cardiologist, personal website, single chamber, Sat+Fri closed",
  "specialty": "cardiologist",
  "deptName": "Cardiologist",
  "card": "",
  "input": "Title: Prof. Dr. Shishir Basak\n\nURL Source: https://www.doctorbangladesh.com/dr-shishir-basak/\n\nPublished Time: 2021-02-28T23:35:54+06:00\n\nMarkdown Content:\n## Chamber & Appointment\n\n**[Mount Adora Hospital, Akhalia, Sylhet](https://www.doctorbangladesh.com/mount-adora-akhalia-doctor-list-contact/)**\n\nAddress: Sylhet-Sunamganj Highway, Akhalia, Sylhet - 3100\n\n**Visiting Hour: 5pm to 10pm (Closed: Sat & Friday)**\n\nAppointment: +8801726450182\n\n[Call Now](tel:+8801726450182)\n\n## টিকিট নেয়ার নিয়ম\n\nপ্রতিদিন সকাল ১০:০০ টা হতে টিকিট দেয়া হয়। শুক্রবার, শনিবার ও সরকারি ছুটির দিন বন্ধ। প্রথমে নিচের লিঙ্কে ক্লিক করে ডাক্তারের ওয়েবসাইটে ঢুকুন। তারপর টিকিটের জন্য Appointment Button এ চাপুন। নতুন পেইজটি খোলার পর আপনার নাম, মোবাইল নাম্বার, ঠিকানা, বয়স এনআইডি নাম্বার সহ প্রয়োজনীয় তথ্যগুলো লিখে Book Now এ চাপুন। তারপর আপনার মোবাইলে একটি সিরিয়াল নাম্বার সহ মেসেজ যাবে। ডাক্তারের সাথে সাক্ষ্যাৎ এর সময় অবশ্যই আপনার মোবাইল সাথে থাকতে হবে।\n\n[ডাক্তারের ওয়েবসাইট](https://drshishirbasak.com/)\n\nProf. Dr. Shishir Basak is a Cardiologist in Sylhet. His qualification is MBBS (DMC), MCPS (Medicine), D-CARD (DU), MD (Cardiology), MRCP (UK). He is a Professor of Medicine at Parkview Medical College & Hospital, Sylhet. He regularly provides treatment to his patients at Mount Adora Hospital, Akhalia, Sylhet. Practicing hour of Prof. Dr. Shishir Basak at Mount Adora Hospital, Akhalia, Sylhet is 5pm to 10pm (Closed: Sat & Friday).\n",
  "output": {
   "name": "Prof. Dr. Shishir Basak",
   "designation": "Professor",
   "specialityArea": "Cardiology Specialist",
   "bmdcRegNo": "",
   "degrees": [
    {
     "title": "MBBS",
     "subject": "",
     "institution": "DMC",
     "country": ""
    },
    {
     "title": "MCPS",
     "subject": "Medicine",
     "institution": "",
     "country": ""
    },
    {
     "title": "D-CARD",
     "subject": "",
     "institution": "DU",
     "country": ""
    },
    {
     "title": "MD",
     "subject": "Cardiology",
     "institution": "",
     "country": ""
    },
    {
     "title": "MRCP",
     "subject": "",
     "institution": "",
     "country": "UK"
    }
   ],
   "workingIn": "professor, cardiologist, parkview medical college & hospital sylhet",
   "phones": [
    "+8801726450182"
   ],
   "email": "",
   "biography": "",
   "extraInformation": "Prof. Dr. Shishir Basak is a Cardiologist in Sylhet. His qualification is MBBS (DMC), MCPS (Medicine), D-CARD (DU), MD (Cardiology), MRCP (UK). He is a Professor of Medicine at Parkview Medical College & Hospital, Sylhet. He regularly provides treatment to his patients at Mount Adora Hospital, Akhalia, Sylhet. Practicing hour of Prof. Dr. Shishir Basak at Mount Adora Hospital, Akhalia, Sylhet is 5pm to 10pm (Closed: Sat & Friday).",
   "gender": "male",
   "website": "https://drshishirbasak.com/",
   "chambers": [
    {
     "facilityName": "Mount Adora Hospital, Akhalia, Sylhet",
     "address": "Sylhet-Sunamganj Highway, Akhalia, Sylhet - 3100",
     "serialTime": "5pm to 10pm (Closed: Sat & Friday)",
     "serialContactNumber": "+8801726450182",
     "workingDays": {
      "Sunday": [
       "17:00",
       "22:00"
      ],
      "Monday": [
       "17:00",
       "22:00"
      ],
      "Tuesday": [
       "17:00",
       "22:00"
      ],
      "Wednesday": [
       "17:00",
       "22:00"
      ],
      "Thursday": [
       "17:00",
       "22:00"
      ],
      "Friday": [],
      "Saturday": []
     }
    }
   ]
  }
 },
 {
  "label": "Female gynae surgeon, BMDC on card, Bengali bio, split Fri hours",
  "specialty": "gynecologist",
  "deptName": "Gynecologist",
  "card": "\n*   BMDC Reg. No: A-63703\n*   MBBS, BCS (Health), MCPS (Obs & Gynae), FCPS (Obs & Gynae)\n*   **10+ Years of Experience**\n*   Obstetrics, Gynaecology Specialist & Surgeon\n*   **Department of Obstetrics & Gynaecology**\n*   Sylhet MAG Osmani Medical College & Hospital\n*   ★★★★★(6)\n\n![Image 2: 🏥](https://s.w.org/images/core/emoji/17.0.2/svg/1f3e5.svg)\n\n*   **Trust Medical Services, Sylhet**\n*   Address: 16, Modhushahid, Osmani Medical Road, Sylhet\n*   **Visiting Hour: 5pm to 8pm (Saturday to Thu), 10am to 12pm (Fri)**\n\n[View Profile](https://www.doctorbangladesh.com/dr-afsana-zakira/)\n\n[![Image 3: Dr. Khursheda Tahmin Shimu](https://www.doctorbangladesh.com/wp-content/uploads/2021/03/Dr.-Khursheda-Tahmin-Shimu-.jpg)](https://www.doctorbangladesh.com/dr-khursheda-tahmin-shimu/)\n",
  "input": "Title: Dr. Afsana Zakira\n\nURL Source: https://www.doctorbangladesh.com/dr-afsana-zakira/\n\nPublished Time: 2026-06-16T17:55:05+06:00\n\nMarkdown Content:\nThis is a verified doctor profile.\n\nThis profile is regularly reviewed and updated through ongoing communication with **the doctor**.\n\nThe information was last updated on **June 21, 2026**.\n\n## Chamber & Appointment\n\n**[Trust Medical Services, Sylhet](https://www.doctorbangladesh.com/trust-medical-sylhet-doctor-list-contact/)**\n\nAddress: 16, Modhushahid, Osmani Medical Road, Sylhet\n\n**Visiting Hour: 5pm to 8pm (Saturday to Thu), 10am to 12pm (Fri)**\n\nAppointment: +8801324993322\n\n[Call Now](tel:+8801324993322)\n\n## ডাঃ আফসানা জাকিরা এর শিক্ষাগত যোগ্যতা ও অভিজ্ঞতা\n\nডা. আফসানা জাকিরা সিলেটের একজন অত্যন্ত দক্ষ **গাইনী ও প্রসূতি রোগ বিশেষজ্ঞ ও সার্জন**। তিনি সফলতার সাথে **MBBS** সম্পন্ন করার পর মর্যাদাপূর্ণ **BCS (Health)** ক্যাডারে উত্তীর্ণ হন। পরবর্তীতে তিনি প্রসূতি ও স্ত্রীরোগ বিষয়ের ওপর বাংলাদেশ কলেজ অব ফিজিশিয়ানস অ্যান্ড সার্জনস থেকে অত্যন্ত মর্যাদাপূর্ণ **MCPS (Obs & Gynae)** এবং **FCPS (Obs & Gynae)** ডিগ্রি অর্জন করেন। দীর্ঘ **১০ বছরেরও বেশি** ক্লিনিক্যাল ও সার্জারি অভিজ্ঞতাসম্পন্ন এই চিকিৎসক বর্তমানে **সিলেট এম.এ.জি ওসমানী মেডিকেল কলেজ ও হাসপাতাল**-এর গাইনী ও প্রসূতি রোগ বিভাগে একজন বিশেষজ্ঞ চিকিৎসক হিসেবে কর্মরত আছেন।\n\n## ডাঃ আফসানা জাকিরা কি কি রোগের চিকিৎসা করেন\n\nতিনি মূলত আধুনিক ও বৈজ্ঞানিক পদ্ধতিতে নারীদের বন্ধ্যাত্ব, প্রসূতি ও স্ত্রীরোগ সংক্রান্ত জটিল সব রোগের সুচিকিৎসা ও অস্ত্রোপচার দিয়ে থাকেন। ওনার বিশেষায়িত চিকিৎসার ক্ষেত্রগুলোর মধ্যে রয়েছে—গর্ভকালীন ও প্রসব পরবর্তী যত্ন, নিরাপদ নরমাল ডেলিভারি ও সিজারিয়ান অপারেশন, জরায়ুর বিভিন্ন সমস্যা, ডিম্বাশয়ের সিস্ট বা টিউমার, অনিয়মিত মাসিক এবং **গাইনী ও প্রসূতি রোগ (Obstetrics & Gynaecology)** সংক্রান্ত যেকোনো জটিলতা। সঠিক রোগ নির্ণয় এবং অত্যন্ত যত্নশীল উপায়ে নারীদের চিকিৎসাসেবা ও সার্জারি সম্পন্ন করতে তিনি বিশেষভাবে পারদর্শী।\n\n## ডাঃ আফসানা জাকিরা এর চেম্বারের সময়সূচী\n\nডা. আফসানা জাকিরা ম্যাম সিলেটের ট্রাস্ট মেডিকেল সার্ভিসেসে চেম্বারে নিয়মিত রোগী দেখেন। ওনার সিরিয়াল বুকিং করার জন্য আপনি ওপরে দেওয়া নাম্বারে যোগাযোগ করতে পারেন। সপ্তাহের **শনিবার থেকে বৃহস্পতিবার** তিনি প্রতিদিন বিকেল ৫টা থেকে রাত ৮টা পর্যন্ত এবং প্রতি **শুক্রবার** সকাল ১০টা থেকে দুপুর ১২টা পর্যন্ত **সিলেটের ট্রাস্ট মেডিকেল সার্ভিসেসে (১৬, মধুশহীদ, ওসমানী মেডিকেল রোড, সিলেট)** নিয়মিত রোগী দেখেন।\n",
  "output": {
   "name": "Dr. Afsana Zakira",
   "designation": "Specialist Physician",
   "specialityArea": "Obstetrics, Gynaecology Specialist & Surgeon",
   "bmdcRegNo": "A-63703",
   "degrees": [
    {
     "title": "MBBS",
     "subject": "",
     "institution": "",
     "country": ""
    },
    {
     "title": "BCS",
     "subject": "Health",
     "institution": "",
     "country": ""
    },
    {
     "title": "MCPS",
     "subject": "Obs & Gynae",
     "institution": "Bangladesh College of Physicians and Surgeons",
     "country": ""
    },
    {
     "title": "FCPS",
     "subject": "Obs & Gynae",
     "institution": "Bangladesh College of Physicians and Surgeons",
     "country": ""
    }
   ],
   "workingIn": "specialist physician, gynecologist, sylhet mag osmani medical college & hospital",
   "phones": [
    "+8801324993322"
   ],
   "email": "",
   "biography": "",
   "extraInformation": "ডা. আফসানা জাকিরা সিলেটের একজন অত্যন্ত দক্ষ গাইনী ও প্রসূতি রোগ বিশেষজ্ঞ ও সার্জন। তিনি সফলতার সাথে MBBS সম্পন্ন করার পর মর্যাদাপূর্ণ BCS (Health) ক্যাডারে উত্তীর্ণ হন। পরবর্তীতে তিনি প্রসূতি ও স্ত্রীরোগ বিষয়ের ওপর বাংলাদেশ কলেজ অব ফিজিশিয়ানস অ্যান্ড সার্জনস থেকে অত্যন্ত মর্যাদাপূর্ণ MCPS (Obs & Gynae) এবং FCPS (Obs & Gynae) ডিগ্রি অর্জন করেন। দীর্ঘ ১০ বছরেরও বেশি ক্লিনিক্যাল ও সার্জারি অভিজ্ঞতাসম্পন্ন এই চিকিৎসক বর্তমানে সিলেট এম.এ.জি ওসমানী মেডিকেল কলেজ ও হাসপাতাল-এর গাইনী ও প্রসূতি রোগ বিভাগে একজন বিশেষজ্ঞ চিকিৎসক হিসেবে কর্মরত আছেন। তিনি মূলত আধুনিক ও বৈজ্ঞানিক পদ্ধতিতে নারীদের বন্ধ্যাত্ব, প্রসূতি ও স্ত্রীরোগ সংক্রান্ত জটিল সব রোগের সুচিকিৎসা ও অস্ত্রোপচার দিয়ে থাকেন। ওনার বিশেষায়িত চিকিৎসার ক্ষেত্রগুলোর মধ্যে রয়েছে—গর্ভকালীন ও প্রসব পরবর্তী যত্ন, নিরাপদ নরমাল ডেলিভারি ও সিজারিয়ান অপারেশন, জরায়ুর বিভিন্ন সমস্যা, ডিম্বাশয়ের সিস্ট বা টিউমার, অনিয়মিত মাসিক এবং গাইনী ও প্রসূতি রোগ (Obstetrics & Gynaecology) সংক্রান্ত যেকোনো জটিলতা। সঠিক রোগ নির্ণয় এবং অত্যন্ত যত্নশীল উপায়ে নারীদের চিকিৎসাসেবা ও সার্জারি সম্পন্ন করতে তিনি বিশেষভাবে পারদর্শী। ডা. আফসানা জাকিরা ম্যাম সিলেটের ট্রাস্ট মেডিকেল সার্ভিসেসে চেম্বারে নিয়মিত রোগী দেখেন। ওনার সিরিয়াল বুকিং করার জন্য আপনি ওপরে দেওয়া নাম্বারে যোগাযোগ করতে পারেন। সপ্তাহের শনিবার থেকে বৃহস্পতিবার তিনি প্রতিদিন বিকেল ৫টা থেকে রাত ৮টা পর্যন্ত এবং প্রতি শুক্রবার সকাল ১০টা থেকে দুপুর ১২টা পর্যন্ত সিলেটের ট্রাস্ট মেডিকেল সার্ভিসেসে (১৬, মধুশহীদ, ওসমানী মেডিকেল রোড, সিলেট) নিয়মিত রোগী দেখেন।",
   "gender": "female",
   "website": "",
   "chambers": [
    {
     "facilityName": "Trust Medical Services, Sylhet",
     "address": "16, Modhushahid, Osmani Medical Road, Sylhet",
     "serialTime": "5pm to 8pm (Saturday to Thu), 10am to 12pm (Fri)",
     "serialContactNumber": "+8801324993322",
     "workingDays": {
      "Sunday": [
       "17:00",
       "20:00"
      ],
      "Monday": [
       "17:00",
       "20:00"
      ],
      "Tuesday": [
       "17:00",
       "20:00"
      ],
      "Wednesday": [
       "17:00",
       "20:00"
      ],
      "Thursday": [
       "17:00",
       "20:00"
      ],
      "Friday": [
       "10:00",
       "12:00"
      ],
      "Saturday": [
       "17:00",
       "20:00"
      ]
     }
    }
   ]
  }
 }
];

export function formatExamples(): string {
  return DOCTOR_EXAMPLES.map((ex, i) =>
    `<worked_example id="${i + 1}" purpose="study only — do NOT copy, do NOT explain">\n<specialty slug="${ex.specialty}" title="${ex.deptName}" />\n<note>${ex.label}</note>\n${ex.card ? `<card>\n${ex.card}\n</card>\n` : ""}<input_profile_markdown>\n${ex.input}\n</input_profile_markdown>\n<correct_output_json>\n${JSON.stringify(ex.output)}\n</correct_output_json>\n</worked_example>`
  ).join("\n");
}
