export const officeAvatars = [
  {id:'architect', name:'蓝衬衫', detail:'短发 · 细领带', skin:0xd9a37e, hair:0x49352c, top:0x7296a8, pants:0x344856, trim:0x37435b, style:'crop', accessory:'tie'},
  {id:'analyst', name:'苔绿针织', detail:'圆框眼镜 · 卷发', skin:0x9e6548, hair:0x262625, top:0x72866a, pants:0x343b3c, trim:0xceb077, style:'curls', accessory:'glasses'},
  {id:'designer', name:'陶红开衫', detail:'齐肩发 · 米色内搭', skin:0xefbd98, hair:0x623b31, top:0xaf6351, pants:0x65534b, trim:0xf0dabc, style:'bob', accessory:'layer'},
  {id:'lead', name:'深蓝西装', detail:'侧分 · 浅色领带', skin:0xca936e, hair:0x252625, top:0x3e5169, pants:0x2d3949, trim:0xbb9774, style:'part', accessory:'tie'},
  {id:'engineer', name:'芥黄工装', detail:'寸发 · 胸前口袋', skin:0x754b3b, hair:0x242526, top:0xbb8d42, pants:0x404340, trim:0xf3c373, style:'buzz', accessory:'pocket'},
  {id:'coordinator', name:'雾紫马甲', detail:'发髻 · 浅灰衬衣', skin:0xc28c68, hair:0x32262d, top:0x8883a1, pants:0x494458, trim:0xe3d8cb, style:'bun', accessory:'layer'},
  {id:'specialist', name:'灰绿夹克', detail:'银发 · 方框眼镜', skin:0xe7b599, hair:0xa6a4a0, top:0x527e76, pants:0x3e4b4e, trim:0xd9ceaa, style:'part', accessory:'glasses'},
  {id:'operator', name:'米白卫衣', detail:'深色连帽 · 棕色长裤', skin:0xb87e61, hair:0x372c2a, top:0xd8ccb1, pants:0x735f52, trim:0x736861, style:'crop', accessory:'hood'},
];

export const avatarIds = ['auto', ...officeAvatars.map(avatar => avatar.id)];

export function resolveAvatar(person) {
  const selected = officeAvatars.find(avatar => avatar.id === person.avatarId);
  if (selected) return selected;
  const byRole = {hr:'coordinator', lead:'lead', finance:'analyst'};
  if (Object.hasOwn(byRole, person.role)) return officeAvatars.find(avatar => avatar.id === byRole[person.role]);
  const identity = person.id ?? person.name ?? '';
  const hash = [...identity].reduce((sum, letter) => (sum * 31 + letter.codePointAt(0)) >>> 0, 0);
  return officeAvatars[hash % officeAvatars.length];
}

export const officeStates = {
  idle:{name:'空闲', color:'#717d6e'},
  queued:{name:'排队', color:'#a17039'},
  thinking:{name:'等待模型', color:'#3e849e'},
  working:{name:'工作中', color:'#238064'},
  speaking:{name:'发言中', color:'#6f58a1'},
  listening:{name:'聆听中', color:'#776aa4'},
  review:{name:'待验收', color:'#427cb0'},
  blocked:{name:'异常', color:'#b45444'},
  stopping:{name:'停止中', color:'#b26d49'},
  paused:{name:'暂停派发', color:'#8b7559'},
  observed:{name:'已观测', color:'#508179'},
  offline:{name:'离线', color:'#7d7d80'},
};

export function avatarFields(person) {
  const selected = avatarIds.includes(person.avatarId) ? person.avatarId : 'auto';
  const options = [{id:'auto',name:'自动',detail:'沿用档案的默认形象'}, ...officeAvatars];
  return `<fieldset class="office-avatar-field" data-avatar-field data-default-avatar="${resolveAvatar({...person,avatarId:'auto'}).id}">
    <legend>办公室人物形象</legend>
    <div class="office-avatar-editor">
      <div class="office-avatar-options">${options.map(({id,name,detail}) => `<label data-avatar="${id}" title="${detail}">
        <input type="radio" name="avatarId" value="${id}"${id === selected ? ' checked' : ''}>
        <i class="office-avatar-swatch" aria-hidden="true"></i><span>${name}</span>
      </label>`).join('')}</div>
      <div class="office-avatar-demo">
        <div class="office-avatar-preview" data-avatar-preview><span>3D 预览</span></div>
        <label>预览状态 <span class="select-control"><select data-avatar-state>
          ${Object.entries(officeStates).map(([id,state]) => `<option value="${id}">${state.name}</option>`).join('')}
        </select></span></label>
      </div>
    </div>
  </fieldset>`;
}
