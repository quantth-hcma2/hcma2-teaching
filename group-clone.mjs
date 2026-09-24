export async function cloneRichTextImages({rich,sourcePrefix,targetPrefix,makeTargetPath,copyAsset,copied=new Map()}) {
  const value=structuredClone(rich);
  for(const block of value.blocks||[]) {
    if(block.type!=="image") continue;
    const sourcePath=block.storagePath;
    if(typeof sourcePath!=="string") throw new Error("Ảnh nguồn không có đường dẫn hợp lệ.");
    if(sourcePath.startsWith(targetPrefix)) continue;
    if(!sourcePath.startsWith(sourcePrefix)) throw new Error(`Ảnh nguồn nằm ngoài vùng của hoạt động: ${sourcePath}`);
    let targetPath=copied.get(sourcePath);
    if(!targetPath) {
      targetPath=makeTargetPath(sourcePath);
      if(!targetPath.startsWith(targetPrefix)) throw new Error("Đường dẫn ảnh đích nằm ngoài vùng của phiên mới.");
      await copyAsset(sourcePath,targetPath,block);
      copied.set(sourcePath,targetPath);
    }
    block.storagePath=targetPath;
  }
  return value;
}

export async function rollbackGroupAssets({paths,targetPrefix,deleteAsset}) {
  const targets=[...new Set(paths)].filter(path=>typeof path==="string" && path.startsWith(targetPrefix));
  const results=await Promise.allSettled(targets.map(deleteAsset));
  return targets.filter((_,index)=>results[index].status==="rejected");
}
