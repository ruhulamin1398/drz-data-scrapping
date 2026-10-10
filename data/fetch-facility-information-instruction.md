- step 1. fetch facility details from url
```
curl "https://r.jina.ai/https://www.example.com" \
  -H "Authorization: Bearer jina_fc8f8a5dd45c4e16a8ac3b858927615cWJ8GO9mbAQZs8o2Wh_dpRuJuchit"
  
  ```

- step 2. trim first 15 lines. 
-  attach this with prompt to extract facility information

```
curl -X POST https://nex-router.onrender.com/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ],
    "max_tokens": 100,
    "temperature": 0.7,
    "stream": false
  }'```

## Location information 
```
Division: Sylhet (id:41) — 4 districts

254. Habiganj
255. Maulvibazar
256. Sunamganj
257. Sylhet
```


## input example 
```Title: Al Haramain Hospital Sylhet Doctor List & Contact - Doctor Bangladesh

URL Source: https://www.doctorbangladesh.com/al-haramain-hospital-sylhet-doctor-list-contact

Published Time: 2021-02-27T15:29:58+06:00

Markdown Content:
## Address & Contact

**Al Haramain Hospital, Sylhet**

 Address: Samato-30, Chali Bandar, Bishwa Road, Subhani Ghat, Sylhet

 Contact: 10607, +8801931225555

[Call Now](tel:+8801931225555)

## আল হারামাইন হাসপাতাল সিলেট ডাক্তার তালিকা

সিলেটের অন্যতম আধুনিক এবং বিশ্বমানের চিকিৎসা সেবা প্রদানকারী প্রতিষ্ঠান হচ্ছে আল হারামাইন হাসপাতাল, সিলেট। উন্নত চিকিৎসা সুবিধা, অভিজ্ঞ বিশেষজ্ঞ ডাক্তার এবং সর্বাধুনিক প্রযুক্তি ব্যবহারের মাধ্যমে এই হাসপাতাল সিলেট অঞ্চলের রোগীদের জন্য নির্ভরযোগ্য স্বাস্থ্যসেবা নিশ্চিত করে আসছে। এখানে মেডিসিন, হৃদরোগ, গাইনি, শিশু, অর্থোপেডিক, ইউরোলজি, চর্ম ও যৌন রোগ, ডায়াবেটিস, নিউরোলজি, নাক-কান-গলা, চোখ, মানসিক রোগসহ বিভিন্ন বিভাগে অভিজ্ঞ বিশেষজ্ঞ ডাক্তাররা নিয়মিত চিকিৎসা সেবা দিয়ে থাকেন। এই পাতায় আমরা আল হারামাইন হাসপাতাল সিলেটে কর্মরত সকল ডাক্তারদের নাম, ডিগ্রি, বিশেষত্ব এবং চেম্বার সময়সূচি বিস্তারিতভাবে তুলে ধরেছি, যাতে আপনি সহজেই আপনার প্রয়োজন অনুযায়ী সঠিক ডাক্তার বেছে নিতে পারেন।


[![Image 1: Dr. Ajoy Kumar Dutta](https://www.doctorbangladesh.com/wp-content/uploads/Dr.-Ajoy-Kumar-Dutta.jpg)](https://www.doctorbangladesh.com/dr-ajoy-kumar-dutta/)

### [Dr. Ajoy Kumar Dutta](https://www.doctorbangladesh.com/dr-ajoy-kumar-dutta/)

*   MBBS, MD (Cardiology), NICVD

*   Cardiology, Hypertension & Rheumatic Fever Specialist
*   **Chief Consultant, Cardiology**
*   Al Haramain Hospital Private Limited, Sylhet
*   ★★★★★(15)

[View Profile](https://www.doctorbangladesh.com/dr-ajoy-kumar-dutta/)

[![Image 2: Dr. Md. Suhail Alam](https://www.doctorbangladesh.com/wp-content/uploads/Dr.-Md.-Suhail-Alam.jpg)](https://www.doctorbangladesh.com/dr-md-suhail-alam/)

### [Dr. Md. Suhail Alam](https://www.doctorbangladesh.com/dr-md-suhail-alam/)

*   MBBS, MD (Cardiology, BSMMU)

*   Cardiology, Heart Diseases & Rheumatic Fever Specialist
*   **Consultant, Cardiology**
*   Al Haramain Hospital Private Limited, Sylhet
*
```

@note: hard containt. you you cannot extract the information form the content then return fileds blank,
## output expample 
```
name: Al Haramain Hospital, 
fullAddress: Samato-30, Chali Bandar, Bishwa Road, Subhani Ghat, Sylhet,
phones: ["10607", "+8801931225555"],
extraInformation: "সিলেটের অন্যতম আধুনিক এবং বিশ্বমানের চিকিৎসা সেবা প্রদানকারী প্রতিষ্ঠান হচ্ছে আল হারামাইন হাসপাতাল, সিলেট। উন্নত চিকিৎসা সুবিধা, অভিজ্ঞ বিশেষজ্ঞ ডাক্তার এবং সর্বাধুনিক প্রযুক্তি ব্যবহারের মাধ্যমে এই হাসপাতাল সিলেট অঞ্চলের রোগীদের জন্য নির্ভরযোগ্য স্বাস্থ্যসেবা নিশ্চিত করে আসছে। এখানে মেডিসিন, হৃদরোগ, গাইনি, শিশু, অর্থোপেডিক, ইউরোলজি, চর্ম ও যৌন রোগ, ডায়াবেটিস, নিউরোলজি, নাক-কান-গলা, চোখ, মানসিক রোগসহ বিভিন্ন বিভাগে অভিজ্ঞ বিশেষজ্ঞ ডাক্তাররা নিয়মিত চিকিৎসা সেবা দিয়ে থাকেন। এই পাতায় আমরা আল হারামাইন হাসপাতাল সিলেটে কর্মরত সকল ডাক্তারদের নাম, ডিগ্রি, বিশেষত্ব এবং চেম্বার সময়সূচি বিস্তারিতভাবে তুলে ধরেছি, যাতে আপনি সহজেই আপনার প্রয়োজন অনুযায়ী সঠিক ডাক্তার বেছে নিতে পারেন।",
divisionId: 41,
districtId: 257,
```