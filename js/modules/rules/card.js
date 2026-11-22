/* 照顧摘要卡的規則（原型第 (18) 版 CARD_A、CARD_B、SRC_TAG、HINT_RULES、hintOptions、cardFromData、buildCard、LANG，內容逐字沿用）。
 * cardFromData 等需要案件規則（confirmedField、dxText、habitLines、cardDiffs），所以包成 cardRules(R)。
 * 欄位標題的印尼文、越南文未經母語人士確認（HANDOFF 10.8、15-7），畫面要標示。
 * tests/unit/card.test.js 直接執行原型的同名函式比對結果。 */
export const CARD_A = [['dx','主要健康問題','conf'],['allergy','過敏','conf'],['tube','管路','conf'],['wound','傷口','conf'],['move','行動與跌倒風險','nurse'],['food','吞嚥與飲食','nurse'],['risk','其他重要照護提醒','nurse']];
export const CARD_B = [['call','慣用稱呼'],['comm','語言與溝通'],['routine','生活作息'],['adl','日常活動協助需求'],['prefs','飲食及活動偏好'],['soothe','情緒安撫方式'],['famNote','其他家屬提供的注意事項']];
export const SRC_TAG = {conf:['已確認醫療資料','conf'], nurse:['護理人員確認','nurse'], fam:['家屬提供','fam'], pend:['待確認','pend']};
export const HINT_RULES = [
  [/aspirin|clopidogrel|plavix|ticagrelor/i, '服用抗血小板藥物：注意出血，跌倒或撞到要立即通報護理站'],
  [/warfarin|rivaroxaban|apixaban|dabigatran|edoxaban/i, '服用抗凝血藥物：注意出血、黑便，跌倒或撞到要立即通報護理站'],
  [/metformin|insulin|glimepiride|gliclazide|sitagliptin/i, '服用降血糖藥：冒冷汗、發抖、反應變慢要立即通報'],
  [/amlodipine|losartan|valsartan|bisoprolol|nifedipine/i, '服用降血壓藥：扶起身時要慢，注意頭暈']
];
export const LANG = {
  zh:{call:'慣用稱呼',move:'行動與跌倒風險',food:'吞嚥與飲食',tube:'管路',risk:'其他重要照護提醒',allergy:'過敏',habit:'生活習慣',hint:'用藥及照護注意事項',title:'照顧摘要卡',arrive:'預計入住',dx:'主要健康問題',wound:'傷口',comm:'語言與溝通',routine:'生活作息',adl:'日常活動協助',prefs:'飲食及活動偏好',soothe:'情緒與安撫方式',famNote:'其他家屬提供的注意事項',secA:'健康與照護重點',secB:'生活與個人偏好（家屬提供之生活資訊）',pending:'待確認資訊'},
  id:{call:'Panggilan',move:'Mobilitas & risiko jatuh',food:'Menelan & makan',tube:'Selang',risk:'Peringatan perawatan penting',allergy:'Alergi',habit:'Kebiasaan',hint:'Peringatan obat & perawatan',title:'Kartu ringkasan perawatan',arrive:'Rencana masuk',dx:'Masalah kesehatan utama',wound:'Luka',comm:'Bahasa & komunikasi',routine:'Rutinitas harian',adl:'Bantuan aktivitas harian',prefs:'Kesukaan makanan & kegiatan',soothe:'Emosi & cara menenangkan',famNote:'Catatan lain dari keluarga',secA:'Kesehatan & perawatan utama',secB:'Kehidupan & preferensi (info dari keluarga)',pending:'Info belum dikonfirmasi'},
  vi:{call:'Cách xưng hô',move:'Đi lại & nguy cơ té ngã',food:'Nuốt & ăn uống',tube:'Ống dẫn',risk:'Lưu ý chăm sóc quan trọng',allergy:'Dị ứng',habit:'Thói quen',hint:'Lưu ý về thuốc & chăm sóc',title:'Thẻ tóm tắt chăm sóc',arrive:'Ngày vào dự kiến',dx:'Vấn đề sức khỏe chính',wound:'Vết thương',comm:'Ngôn ngữ & giao tiếp',routine:'Sinh hoạt hằng ngày',adl:'Hỗ trợ sinh hoạt',prefs:'Sở thích ăn uống & hoạt động',soothe:'Cảm xúc & cách xoa dịu',famNote:'Lưu ý khác từ gia đình',secA:'Sức khỏe & chăm sóc chính',secB:'Sinh hoạt & sở thích (thông tin do gia đình cung cấp)',pending:'Thông tin chưa xác nhận'}
};

export function cardRules(R){
  const { confirmedField, dxText, habitLines, cardDiffs } = R;
  function hintOptions(c){ const meds = confirmedField(c, 'meds'); return HINT_RULES.filter(([re]) => re.test(meds)).map(([, t]) => t); }
  function cardFromData(c){
    const a = c.assessment || {}, tube = confirmedField(c, 'tube'), sw = confirmedField(c, 'swallow');
    const j = (...x) => x.filter(v => v && String(v).trim()).join('；');
    return Object.assign({dx:dxText(c), allergy:confirmedField(c, 'allergy'), tube:j(tube, confirmedField(c, 'tubeCare')), wound:j(confirmedField(c, 'wound'), confirmedField(c, 'woundCare')),
      move:j(a.move, confirmedField(c, 'mobility')), food: sw || (tube && /鼻胃管|胃造/.test(tube) ? '管灌飲食，不可由口進食' : '')}, habitLines(c), {pending:cardDiffs(c), layout:2, habitRev: c.habit ? c.habit.rev || 0 : 0});
  }
  function buildCard(c){
    return Object.assign({status:'草稿', v:(c.card && c.card.v ? c.card.v + 1 : 1), caregivers:[], risk:'', hints:[]}, cardFromData(c));
  }
  return { hintOptions, cardFromData, buildCard };
}
