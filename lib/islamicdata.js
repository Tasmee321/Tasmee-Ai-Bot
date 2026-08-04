// ============================================
// Static Islamic reference data — kept local (not from any API) so these
// commands never fail due to a third-party outage.
// ============================================

// Asma-ul-Husna — 99 Names of Allah (Arabic transliteration + short Urdu-Roman meaning)
const ASMA_UL_HUSNA = [
    ["Ar-Rahman", "Nihayat Meherbaan"], ["Ar-Rahim", "Bohat Reham Karne Wala"],
    ["Al-Malik", "Badshah, Haqiqi Maalik"], ["Al-Quddus", "Nihayat Pak"],
    ["As-Salam", "Salamti Dene Wala"], ["Al-Mu'min", "Aman Dene Wala"],
    ["Al-Muhaymin", "Nigehban"], ["Al-Aziz", "Ghalib, Izzat Wala"],
    ["Al-Jabbar", "Zabardast"], ["Al-Mutakabbir", "Bara'i Wala"],
    ["Al-Khaliq", "Paida Karne Wala"], ["Al-Bari", "Bila Misal Banane Wala"],
    ["Al-Musawwir", "Surat Banane Wala"], ["Al-Ghaffar", "Bohat Bakhshne Wala"],
    ["Al-Qahhar", "Sab Par Ghalib"], ["Al-Wahhab", "Bohat Ata Karne Wala"],
    ["Ar-Razzaq", "Rizq Dene Wala"], ["Al-Fattah", "Faisla Karne Wala/Kholne Wala"],
    ["Al-Alim", "Sab Kuch Jaanne Wala"], ["Al-Qabid", "Tangi Dene Wala"],
    ["Al-Basit", "Kushadgi Dene Wala"], ["Al-Khafid", "Past Karne Wala"],
    ["Ar-Rafi", "Buland Karne Wala"], ["Al-Mu'izz", "Izzat Dene Wala"],
    ["Al-Muzil", "Zillat Dene Wala"], ["As-Sami", "Sab Kuch Sunne Wala"],
    ["Al-Basir", "Sab Kuch Dekhne Wala"], ["Al-Hakam", "Faisla Karne Wala"],
    ["Al-Adl", "Insaf Karne Wala"], ["Al-Latif", "Baareek Bin Jaanne Wala"],
    ["Al-Khabir", "Har Baat Se Aagah"], ["Al-Halim", "Bardbaar"],
    ["Al-Azim", "Bohat Bara"], ["Al-Ghafur", "Bakhshne Wala"],
    ["Ash-Shakur", "Qadar Daan"], ["Al-Ali", "Sab Se Buland"],
    ["Al-Kabir", "Sab Se Bara"], ["Al-Hafiz", "Hifazat Karne Wala"],
    ["Al-Muqit", "Rozi Dene Wala"], ["Al-Hasib", "Hisab Lene Wala"],
    ["Al-Jalil", "Jalal Wala"], ["Al-Karim", "Bohat Karam Karne Wala"],
    ["Ar-Raqib", "Nigehbaan"], ["Al-Mujib", "Dua Qubool Karne Wala"],
    ["Al-Wasi", "Kushada"], ["Al-Hakim", "Hikmat Wala"],
    ["Al-Wadud", "Muhabbat Karne Wala"], ["Al-Majid", "Buzurgi Wala"],
    ["Al-Ba'ith", "Dobara Zinda Karne Wala"], ["Ash-Shahid", "Gawah"],
    ["Al-Haqq", "Haqq"], ["Al-Wakil", "Kaarsaaz"],
    ["Al-Qawi", "Zor Aawar"], ["Al-Matin", "Mazboot"],
    ["Al-Wali", "Kaarsaaz Dost"], ["Al-Hamid", "Har Tarah Qabil-e-Tareef"],
    ["Al-Muhsi", "Ginne Wala"], ["Al-Mubdi", "Shuru Karne Wala"],
    ["Al-Mu'id", "Dobara Paida Karne Wala"], ["Al-Muhyi", "Zindagi Dene Wala"],
    ["Al-Mumit", "Maut Dene Wala"], ["Al-Hayy", "Zinda"],
    ["Al-Qayyum", "Qayam Rakhne Wala"], ["Al-Wajid", "Paane Wala"],
    ["Al-Majid", "Buzurgi Wala"], ["Al-Wahid", "Akela, Yakta"],
    ["Al-Ahad", "Ek"], ["As-Samad", "Be-Niyaz"],
    ["Al-Qadir", "Qudrat Wala"], ["Al-Muqtadir", "Poori Qudrat Wala"],
    ["Al-Muqaddim", "Aage Karne Wala"], ["Al-Mu'akhkhir", "Peechay Karne Wala"],
    ["Al-Awwal", "Sab Se Pehla"], ["Al-Akhir", "Sab Se Aakhri"],
    ["Az-Zahir", "Zahir"], ["Al-Batin", "Poshida"],
    ["Al-Wali", "Hukmran"], ["Al-Muta'ali", "Buland-o-Bala"],
    ["Al-Barr", "Bhalai Karne Wala"], ["At-Tawwab", "Tauba Qubool Karne Wala"],
    ["Al-Muntaqim", "Badla Lene Wala"], ["Al-Afuww", "Maaf Karne Wala"],
    ["Ar-Ra'uf", "Nihayat Shafiq"], ["Malik-ul-Mulk", "Mulk Ka Maalik"],
    ["Dhul-Jalali-Wal-Ikram", "Buzurgi Aur Ikram Wala"],
    ["Al-Muqsit", "Insaf Karne Wala"], ["Al-Jami", "Jama Karne Wala"],
    ["Al-Ghani", "Be-Niyaz"], ["Al-Mughni", "Ghani Karne Wala"],
    ["Al-Mani", "Rokne Wala"], ["Ad-Darr", "Nuqsan Dene Ki Qudrat Rakhne Wala"],
    ["An-Nafi", "Faida Dene Wala"], ["An-Nur", "Roshni"],
    ["Al-Hadi", "Hidayat Dene Wala"], ["Al-Badi", "Be-Misal Banane Wala"],
    ["Al-Baqi", "Hamesha Rehne Wala"], ["Al-Warith", "Sab Ka Warris"],
    ["Ar-Rashid", "Seedhi Raah Dikhane Wala"], ["As-Sabur", "Bohat Sabr Karne Wala"],
];

// Common everyday duas — Urdu-Roman transliteration + short meaning. Kept
// small and reliable rather than pulling from an external source.
const DUAS = [
    {
        title: "Khane Se Pehle Ki Dua",
        arabic: "بِسْمِ اللَّهِ",
        translit: "Bismillah",
        meaning: "Allah ke naam se (shuru karta hoon)",
    },
    {
        title: "Khane Ke Baad Ki Dua",
        arabic: "الْحَمْدُ لِلَّهِ الَّذِي أَطْعَمَنَا وَسَقَانَا وَجَعَلَنَا مُسْلِمِينَ",
        translit: "Alhamdulillahil-lazi at'amana wa saqana wa ja'alana Muslimin",
        meaning: "Tamam tareefein Allah ke liye jisne humein khilaya, pilaya aur Musalman banaya",
    },
    {
        title: "Ghar Se Nikalte Waqt Ki Dua",
        arabic: "بِسْمِ اللَّهِ تَوَكَّلْتُ عَلَى اللَّهِ وَلَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللَّهِ",
        translit: "Bismillahi tawakkaltu 'alallahi wa la hawla wa la quwwata illa billah",
        meaning: "Allah ke naam se, maine Allah par bharosa kiya, koi taqat-o-qudrat Allah ke bagair nahi",
    },
    {
        title: "Safar Ki Dua",
        arabic: "سُبْحَانَ الَّذِي سَخَّرَ لَنَا هَذَا وَمَا كُنَّا لَهُ مُقْرِنِينَ",
        translit: "Subhanal-lazi sakhkhara lana haza wa ma kunna lahu muqrinin",
        meaning: "Pak hai wo Zaat jisne is sawari ko humare kaabu mein diya",
    },
    {
        title: "Soney Se Pehle Ki Dua",
        arabic: "بِاسْمِكَ اللَّهُمَّ أَمُوتُ وَأَحْيَا",
        translit: "Bismika Allahumma amutu wa ahya",
        meaning: "Aye Allah tere naam ke sath marta aur jeeta hoon",
    },
    {
        title: "Neend Se Uthne Ki Dua",
        arabic: "الْحَمْدُ لِلَّهِ الَّذِي أَحْيَانَا بَعْدَ مَا أَمَاتَنَا وَإِلَيْهِ النُّشُورُ",
        translit: "Alhamdulillahil-lazi ahyana ba'da ma amatana wa ilayhin-nushur",
        meaning: "Tareef Allah ke liye jisne humein marne (soney) ke baad zinda kiya, ussi ki taraf lautna hai",
    },
    {
        title: "Bathroom Jaane Se Pehle",
        arabic: "اللَّهُمَّ إِنِّي أَعُوذُ بِكَ مِنَ الْخُبُثِ وَالْخَبَائِثِ",
        translit: "Allahumma inni a'udhu bika minal khubuthi wal khaba'ith",
        meaning: "Aye Allah main khabees jinnat/shayateen se teri panah maangta hoon",
    },
    {
        title: "Naye Kapre Pehnne Ki Dua",
        arabic: "الْحَمْدُ لِلَّهِ الَّذِي كَسَانِي هَذَا وَرَزَقَنِيهِ مِنْ غَيْرِ حَوْلٍ مِنِّي وَلَا قُوَّةٍ",
        translit: "Alhamdulillahil-lazi kasani haza wa razaqanihi min ghayri hawlin minni wa la quwwah",
        meaning: "Tareef Allah ke liye jisne mujhe ye pehnaya aur bina meri taqat ke rizq diya",
    },
    {
        title: "Mushkil/Pareshani Ki Dua",
        arabic: "حَسْبُنَا اللَّهُ وَنِعْمَ الْوَكِيلُ",
        translit: "Hasbunallahu wa ni'mal wakil",
        meaning: "Allah hamare liye kaafi hai aur wo behtareen kaarsaaz hai",
    },
    {
        title: "Maafi Maangne Ki Dua (Istighfar)",
        arabic: "أَسْتَغْفِرُ اللَّهَ الْعَظِيمَ",
        translit: "Astaghfirullah-al-Azeem",
        meaning: "Main Allah-e-Azeem se maafi maangta hoon",
    },
];

module.exports = { ASMA_UL_HUSNA, DUAS };
