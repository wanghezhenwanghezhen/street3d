// Shared geometry is owned by a lease, never by an individual cloned mesh.
export function createResourceCache({load,dispose}){
  const entries=new Map();let created=0,released=0;
  function retire(key,entry){
    if(entry.refs||!entry.value)return;
    if(entries.get(key)===entry)entries.delete(key);
    const value=entry.value;entry.value=null;dispose(value);released++;
  }
  async function acquire(key,input){
    let entry=entries.get(key);
    if(!entry){
      entry={refs:0,value:null,promise:null};entries.set(key,entry);created++;
      entry.promise=Promise.resolve().then(()=>load(input)).then(value=>{entry.value=value;return value;});
    }
    entry.refs++;
    try{
      const value=await entry.promise;let active=true;
      return {value,release(){if(!active)return;active=false;entry.refs--;retire(key,entry);}};
    }catch(error){
      entry.refs--;if(entries.get(key)===entry)entries.delete(key);throw error;
    }
  }
  function snapshot(){return {entries:entries.size,created,released,rows:[...entries].map(([key,e])=>({key,refs:e.refs,ready:!!e.value}))};}
  return {acquire,snapshot};
}
