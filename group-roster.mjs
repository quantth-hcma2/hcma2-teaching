export function normalizeStudentName(value) {
  const name=String(value??"").normalize("NFC").replace(/[\u0000-\u001F\u007F]/g," ").replace(/\s+/g," ").trim();
  if(name.length<2 || name.length>100) throw new Error("Họ tên phải có từ 2 đến 100 ký tự.");
  return name;
}

export function groupDisplayName(activity,group) {
  const configured=Array.isArray(activity?.groupNames)?activity.groupNames[group-1]:null;
  return typeof configured==="string" && configured.trim()?configured.trim():`Nhóm ${group}`;
}

export function safeExcelText(value) {
  const text=String(value??"");
  return /^[=+\-@]/.test(text)?`'${text}`:text;
}

export function uniqueExcelSheetNames(names) {
  const used=new Set();
  return names.map((raw,index)=>{
    let base=String(raw||`Nhóm ${index+1}`).replace(/[\\\/?*\[\]:]/g," ").replace(/\s+/g," ").trim().replace(/^'+|'+$/g,"")||`Nhóm ${index+1}`;
    base=base.slice(0,31);
    let candidate=base,ordinal=2;
    while(used.has(candidate.toLocaleLowerCase("vi"))){
      const suffix=` (${ordinal++})`;
      candidate=base.slice(0,31-suffix.length)+suffix;
    }
    used.add(candidate.toLocaleLowerCase("vi"));
    return candidate;
  });
}

export function buildGroupRosterExport(activity,members) {
  const count=Math.max(2,Math.min(12,Number(activity?.groupCount)||2));
  const groupNames=Array.from({length:count},(_,i)=>groupDisplayName(activity,i+1));
  const sheetNames=uniqueExcelSheetNames(groupNames);
  // Future session context can add subjectName/lessonName without changing sheet construction.
  const contextFields=[
    ["Lớp",activity?.className||"Chưa gắn lớp"],
    ["Nhóm",null],
    ...(activity?.subjectName?[["Môn học",activity.subjectName]]:[]),
    ...(activity?.lessonName?[["Bài học",activity.lessonName]]:[])
  ];
  return {sheets:Array.from({length:count},(_,i)=>{
    const group=i+1;
    const rows=members.filter(m=>Number(m.group)===group).sort((a,b)=>String(a.displayName||"").localeCompare(String(b.displayName||""),"vi"));
    const context=contextFields.map(([label,value])=>[label,label==="Nhóm"?groupNames[i]:value]);
    return {group,groupName:groupNames[i],sheetName:sheetNames[i],context,members:rows.map((m,index)=>({stt:index+1,fullName:safeExcelText(m.displayName||"")}))};
  })};
}

export function buildGroupRosterWorkbook(XLSX,activity,members) {
  if(!XLSX?.utils?.book_new) throw new Error("Không tải được bộ tạo tệp Excel trên bản thử.");
  const model=buildGroupRosterExport(activity,members),workbook=XLSX.utils.book_new();
  model.sheets.forEach(sheet=>{
    const rows=[["DANH SÁCH HỌC VIÊN",""]];
    sheet.context.forEach(row=>rows.push(row));
    rows.push([], ["STT","Họ tên học viên"]);
    sheet.members.forEach(m=>rows.push([m.stt,m.fullName]));
    const worksheet=XLSX.utils.aoa_to_sheet(rows),headerRow=sheet.context.length+3;
    worksheet["!merges"]=[{s:{r:0,c:0},e:{r:0,c:1}}];
    worksheet["!cols"]=[{wch:8},{wch:42}];
    worksheet["!autofilter"]={ref:`A${headerRow}:B${Math.max(headerRow,rows.length)}`};
    XLSX.utils.book_append_sheet(workbook,worksheet,sheet.sheetName);
  });
  return {workbook,model};
}
