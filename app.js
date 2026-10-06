const $ = id => document.getElementById(id);
const loginScreen = $('loginScreen');
const appShell = $('appShell');
const loginForm = $('loginForm');
const loginError = $('loginError');
const messages = $('messages');
const quickActions = $('quickActions');
const chatForm = $('chatForm');
const messageInput = $('messageInput');
const counter = $('counter');
const sidebar = $('sidebar');

const CONTACT_PHONE = '7795 7795';
const CONTACT_WHATSAPP = '50277957795';
const RAG_API_URL = '/api/chat';
const RAG_STATUS_URL = '/api/health';

let CURRENT_USER = null;
let CSRF_TOKEN = '';
let AGENCIES = [];
let PREQUAL_CACHE = [];
let CHAT_CONVERSATION_ID = null;

const WORKFLOW_STATUSES = [
  { value:'pendiente', label:'Pendiente' },
  { value:'en_revision', label:'En revisión' },
  { value:'contactado', label:'Contactado' },
  { value:'derivado', label:'Derivado a proceso formal' },
  { value:'cerrado', label:'Cerrado' }
];

const SERVICE_LINKS = {
  prestamos: 'https://www.coluarl.com.gt/index.php/productos/mi-prestamo',
  ahorros: 'https://www.coluarl.com.gt/index.php/productos/mi-ahorro',
  remesas: 'https://www.coluarl.com.gt/index.php/productos/mi-remesa',
  agencias: 'https://www.coluarl.com.gt/index.php/puntos-servicio/agencias',
  sitio: 'https://www.coluarl.com.gt/'
};

async function apiFetch(url, options={}){
  const opts={credentials:'same-origin',...options};
  const method=String(opts.method||'GET').toUpperCase();
  const headers=new Headers(opts.headers||{});
  if(opts.body && !headers.has('Content-Type')) headers.set('Content-Type','application/json');
  if(!['GET','HEAD','OPTIONS'].includes(method) && CSRF_TOKEN){
    headers.set('X-CSRF-Token',CSRF_TOKEN);
  }
  opts.headers=headers;
  const response=await fetch(url,opts);
  let data={};
  try{ data=await response.json(); }catch{}
  if(!response.ok || data.ok===false){
    const error=new Error(data.detail || data.error || data.message || 'No fue posible completar la solicitud.');
    error.status=response.status;
    if(response.status===401 && CURRENT_USER){
      clearCurrentUser();
      appShell.classList.add('hidden');
      loginScreen.classList.remove('hidden');
      if(typeof showLogin==='function') showLogin();
      loginError.textContent='Tu sesión expiró. Inicia sesión nuevamente.';
    }
    throw error;
  }
  return data;
}

function currentUser(){ return CURRENT_USER; }
function syncCurrentUser(user){ CURRENT_USER=user; }
function clearCurrentUser(){ CURRENT_USER=null; CSRF_TOKEN=''; CHAT_CONVERSATION_ID=null; PREQUAL_CACHE=[]; }

async function loadAgencies(){
  const data=await apiFetch('/api/agencies');
  AGENCIES=(data.agencies||[]).map(a=>({
    id:a.id,name:a.name,department:a.department||'',phones:Array.isArray(a.phones)?a.phones:[]
  }));
  populateAgencySelect();
  populateAdvisorAgencyFilter();
}

async function refreshPrequalifications(){
  if(!CURRENT_USER){ PREQUAL_CACHE=[]; return PREQUAL_CACHE; }
  const data=await apiFetch('/api/prequalifications');
  PREQUAL_CACHE=(data.items||[]).map(normalizePrequalification);
  return PREQUAL_CACHE;
}

const knowledge = {
  prestamos: { label:'Préstamos y créditos', question:'¿Qué préstamos ofrece COLUA?' },
  requisitosCredito: { label:'Requisitos de crédito', question:'¿Qué necesito para solicitar un crédito?' },
  procesoCredito: { label:'Proceso de crédito', question:'¿Cómo funciona el proceso para solicitar un crédito?' },
  precalificacion: { label:'Precalificación crediticia', question:'Quiero iniciar una precalificación de crédito.' },
  ahorros: { label:'Ahorros', question:'Quiero información sobre los productos de ahorro.' },
  asociarme: { label:'Asociación', question:'¿Qué necesito para asociarme?' },
  remesas: { label:'Remesas', question:'¿Cómo funciona el servicio de remesas?' },
  tarjetas: { label:'Tarjetas', question:'Quiero información sobre las tarjetas.' },
  contacto: { label:'Contacto y agencias', question:'¿Cómo puedo contactar a COLUA?' },
  institucional: { label:'Información institucional', question:'Cuéntame sobre COLUA.' },
  otros: { label:'Otras consultas' }
};

const ANALYTICS_MEMORY={actions:{}};
function getState(){ return ANALYTICS_MEMORY; }
function saveState(){ /* Persistencia analítica en servidor; no se usa almacenamiento del navegador. */ }
function getPrequalifications(){ return PREQUAL_CACHE; }
function savePrequalifications(){ /* Las precalificaciones se guardan mediante /api/prequalifications. */ }
function currentTime(){ return new Intl.DateTimeFormat('es-GT',{hour:'2-digit',minute:'2-digit'}).format(new Date()); }
function currentDateTime(){ return new Intl.DateTimeFormat('es-GT',{dateStyle:'short',timeStyle:'short'}).format(new Date()); }
function escapeHtml(text){ return String(text).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function formatMoney(value){ return new Intl.NumberFormat('es-GT',{style:'currency',currency:'GTQ',maximumFractionDigits:2}).format(Number(value)||0); }
function roleLabel(role){
  if(role==='administrador') return 'Administrador';
  if(role==='asesor') return 'Asesor de agencia';
  return 'Asociado';
}
function workflowLabel(value){ return WORKFLOW_STATUSES.find(item=>item.value===value)?.label || 'Pendiente'; }
function workflowClass(value){ return `status-${String(value||'pendiente').replace(/_/g,'-')}`; }
function formatPhone(value){
  const digits=digitsOnly(value);
  return digits.length===8 ? `${digits.slice(0,4)} ${digits.slice(4)}` : String(value||'No indicado');
}
function getAgencyId(name){ return getAgencyByName(name)?.id || ''; }
function normalizePrequalification(record){
  const agency=record.agency || 'No indicada';
  return {
    ...record,
    id:record.id || record.code || '',
    username:record.username || 'anónimo',
    applicantName:record.applicantName || record.name || record.username || 'Usuario',
    agency,
    agencyId:record.agencyId || record.agency_id || getAgencyId(agency),
    phone:record.phone || '',
    contactPreference:record.contactPreference || 'No indicado',
    income:Number(record.income || 0),
    employment:record.employment || 'No indicado',
    tenure:Number(record.tenure || record.tenure_months || 0),
    debts:Number(record.debts || 0),
    available:Number(record.available || 0),
    requestedAmount:Number(record.requestedAmount || record.requested_amount || 0),
    purpose:record.purpose || 'No indicado',
    arrears:Boolean(record.arrears),
    debtRatio:Number(record.debtRatio || record.debt_ratio || 0),
    preliminaryResult:record.preliminaryResult || 'Perfil listo para revisión institucional',
    workflowStatus:record.workflowStatus || 'pendiente',
    advisorNotes:record.advisorNotes || '',
    assignedAdvisor:record.assignedAdvisor || '',
    createdAt:record.createdAt || '',
    updatedAt:record.updatedAt || '',
    history:Array.isArray(record.history) ? record.history : []
  };
}
function migratePrequalifications(){ return PREQUAL_CACHE.map(normalizePrequalification); }
function canViewPrequalification(record,user=currentUser()){
  if(!user) return false;
  if(user.role==='administrador') return true;
  if(user.role==='asesor') return Boolean(user.agencyId) && normalizePrequalification(record).agencyId===user.agencyId;
  return normalizePrequalification(record).username===user.username;
}


function normalizeText(value){
  return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
}
function digitsOnly(phone){ return String(phone||'').replace(/\D/g,''); }
function getAgencyByName(name){
  const target=normalizeText(name).replace(/^agencia\s+/,'');
  return AGENCIES.find(a=>normalizeText(a.name).replace(/^agencia\s+/,'')===target) || null;
}
function currentAgencyContact(){
  const user=currentUser();
  return user?.agency ? getAgencyByName(user.agency) : null;
}
function buildWhatsAppUrl(message=''){
  return `https://wa.me/${CONTACT_WHATSAPP}?text=${encodeURIComponent(message)}`;
}
function openExternal(url){ window.open(url,'_blank','noopener,noreferrer'); }
function callPhone(phone){ window.location.href=`tel:${digitsOnly(phone)}`; }
function trackAction(action, detail=''){
  ANALYTICS_MEMORY.actions[action]=(ANALYTICS_MEMORY.actions[action]||0)+1;
}
function openWhatsApp(context='consulta general'){
  trackAction('whatsapp',context);
  const user=currentUser();
  const agency=user?.agency ? ` Mi agencia registrada es ${user.agency}.` : '';
  openExternal(buildWhatsAppUrl(`Hola, soy ${user?.name||'un asociado'} y deseo continuar con ${context}.${agency}`));
}
function openAgencyDirectory(){
  trackAction('directorio_agencias','Apertura del directorio');
  renderAgencyDirectory();
  $('agencyModal').classList.remove('hidden');
}
function closeAgencyDirectory(){ $('agencyModal').classList.add('hidden'); }
function renderAgencyDirectory(){
  const list=$('agencyList');
  if(!list) return;
  const userAgency=currentAgencyContact();
  list.innerHTML='';
  AGENCIES.forEach(agency=>{
    const card=document.createElement('article');
    card.className=`agency-card${userAgency?.id===agency.id?' preferred':''}`;
    const phoneText=agency.phones.join(' / ');
    card.innerHTML=`<div><strong>${escapeHtml(agency.name)}</strong>${userAgency?.id===agency.id?'<span class="agency-badge">Tu agencia</span>':''}<small>${escapeHtml(phoneText)}</small></div>`;
    const actions=document.createElement('div'); actions.className='agency-card-actions';
    agency.phones.forEach(phone=>{
      const b=document.createElement('button'); b.type='button'; b.textContent=`Llamar ${phone}`;
      b.addEventListener('click',()=>{trackAction('llamada_agencia',`${agency.name} ${phone}`);callPhone(phone);});
      actions.appendChild(b);
    });
    card.appendChild(actions); list.appendChild(card);
  });
}
function addActionButtons(actions=[]){
  if(!actions.length) return;
  const row=document.createElement('div');
  row.className='chat-actions-row';
  actions.forEach(action=>{
    const b=document.createElement('button');
    b.type='button';
    b.className=action.primary?'chat-action primary':'chat-action';
    b.textContent=action.label;
    b.addEventListener('click',action.onClick);
    row.appendChild(b);
  });
  messages.appendChild(row);
  messages.scrollTop=messages.scrollHeight;
}
function contactActions(context='tu consulta'){
  const agency=currentAgencyContact();
  const actions=[
    {label:'Continuar por WhatsApp',primary:true,onClick:()=>openWhatsApp(context)},
    {label:`Llamar al ${CONTACT_PHONE}`,onClick:()=>{trackAction('llamada_general',context);callPhone(CONTACT_PHONE);}},
    {label:'Ver agencias',onClick:openAgencyDirectory}
  ];
  if(agency && agency.phones[0]){
    actions.unshift({
      label:`Llamar a ${agency.name}`,
      primary:true,
      onClick:()=>{trackAction('llamada_agencia',`${agency.name} · ${context}`);callPhone(agency.phones[0]);}
    });
  }
  addActionButtons(actions);
}

function showColuaContactOptions(context='tu consulta'){
  const agency=currentAgencyContact();

  addMessage(
    agency
      ? `Para continuar con ${context}, puedes comunicarte directamente con ${agency.name} o utilizar los canales generales de COLUA.`
      : `Para continuar con ${context}, puedes comunicarte directamente con COLUA o consultar el directorio de agencias.`,
    'bot'
  );

  const actions=[];

  if(agency && agency.phones?.[0]){
    actions.push({
      label:`Llamar a ${agency.name}`,
      primary:true,
      onClick:()=>{
        trackAction('llamada_agencia',`${agency.name} · ${context}`);
        callPhone(agency.phones[0]);
      }
    });
  }

  actions.push({
    label:`Llamar al ${CONTACT_PHONE}`,
    primary:!agency,
    onClick:()=>{
      trackAction('llamada_general',context);
      callPhone(CONTACT_PHONE);
    }
  });

  actions.push({
    label:'Ver agencias',
    onClick:openAgencyDirectory
  });

  actions.push({
    label:'Abrir sitio oficial',
    onClick:()=>{
      trackAction('redireccion_servicio',`Sitio oficial · ${context}`);
      openExternal(SERVICE_LINKS.sitio);
    }
  });

  addActionButtons(actions);
}

function serviceActions(topic){
  const actions=[];
  if(topic==='prestamos' || topic==='requisitosCredito' || topic==='procesoCredito'){
    actions.push({label:'Iniciar precalificación',primary:true,onClick:startPrequalification});
    actions.push({label:'Ver información de préstamos',onClick:()=>{trackAction('redireccion_servicio','Préstamos');openExternal(SERVICE_LINKS.prestamos);}});
    actions.push({label:'Hablar con COLUA',onClick:()=>showColuaContactOptions('una consulta sobre créditos')});
  } else if(topic==='ahorros'){
    actions.push({label:'Ver información de ahorros',primary:true,onClick:()=>{trackAction('redireccion_servicio','Ahorros');openExternal(SERVICE_LINKS.ahorros);}});
    actions.push({label:'Hablar con COLUA',onClick:()=>showColuaContactOptions('una consulta sobre ahorros')});
  } else if(topic==='remesas'){
    actions.push({label:'Ver información de remesas',primary:true,onClick:()=>{trackAction('redireccion_servicio','Remesas');openExternal(SERVICE_LINKS.remesas);}});
    actions.push({label:'Hablar con COLUA',onClick:()=>showColuaContactOptions('una consulta sobre remesas')});
  } else if(topic==='contacto'){
    actions.push({label:`Llamar al ${CONTACT_PHONE}`,primary:true,onClick:()=>{trackAction('llamada_general','Contacto');callPhone(CONTACT_PHONE);}});
    actions.push({label:'Ver agencias',onClick:openAgencyDirectory});
    actions.push({label:'Abrir sitio oficial',onClick:()=>{trackAction('redireccion_servicio','Sitio oficial');openExternal(SERVICE_LINKS.sitio);}});
  }
  addActionButtons(actions);
}



function renderUserAvatar(element, user){

  if(!element) return;

  element.innerHTML = '';

  if(user.profileImage){

    const img = document.createElement('img');

    img.src = user.profileImage;
    img.alt = 'Foto de perfil';

    element.appendChild(img);

  }else{

    element.textContent =
      (user.name || 'U').charAt(0).toUpperCase();

  }
}
function openApp(user){
  CURRENT_USER=user;
  const isAdmin=user.role==='administrador';
  const isAdvisor=user.role==='asesor';
  const isStaff=isAdmin||isAdvisor;

  loginScreen.classList.add('hidden');
  appShell.classList.remove('hidden');
  document.body.dataset.role=user.role||'asociado';
  $('sessionName').textContent=user.name;
  $('sessionRole').textContent=isAdmin ? 'Administrador' : isAdvisor ? `Asesor${user.agency ? ' · '+user.agency : ''}` : `Asociado${user.agency ? ' · '+user.agency : ''}`;
  renderUserAvatar($('sessionAvatar'),user);
  document.querySelectorAll('.admin-only').forEach(el=>el.style.display=isAdmin?'':'none');
  document.querySelectorAll('.staff-only').forEach(el=>el.style.display=isStaff?'':'none');
  document.querySelectorAll('.member-only').forEach(el=>el.style.display=isAdvisor?'none':'');
  initialize();
  renderAnalytics();
  renderAdvisorDashboard();
  showSection(isAdvisor ? 'advisor' : 'home');
}

loginForm.addEventListener('submit', async e=>{
  e.preventDefault();
  loginError.textContent='';
  try{
    const data=await apiFetch('/api/auth/login',{
      method:'POST',
      body:JSON.stringify({
        username:$('loginUser').value.trim().toLowerCase(),
        password:$('loginPassword').value,
        remember:$('rememberUser').checked
      })
    });
    CSRF_TOKEN=data.csrfToken||'';
    openApp(data.user);
    $('loginPassword').value='';
    if(data.user.mustChangePassword){
      setTimeout(()=>openProfileModal(),350);
      showToast('Por seguridad, cambia la contraseña temporal.','error');
    }
  }catch(error){
    loginError.textContent=error.message || 'Usuario o contraseña incorrectos.';
  }
});
function openProfileModal(){

  const session = currentUser();

  if(!session) return;

  const storedUser = session;

  $('profileName').value =
    storedUser.name || session.name || '';

  $('profileUsername').value =
    session.username || '';

  $('profileAgency').value =
    storedUser.agency || 'No indicada';

  $('profileRole').value = roleLabel(storedUser.role);

  $('profileDisplayName').textContent =
    storedUser.name || session.name || 'Usuario COLUA';

  $('profileDisplayRole').textContent = roleLabel(storedUser.role);

  $('profileDisplayAgency').textContent =
    storedUser.agency || 'Agencia no indicada';

  renderUserAvatar(
    $('profileAvatarPreview'),
    storedUser
  );

  $('currentProfilePassword').value = '';
  $('newProfilePassword').value = '';
  $('confirmProfilePassword').value = '';

  ['currentProfilePassword','newProfilePassword','confirmProfilePassword'].forEach(id => {
    $(id).type = 'password';
  });
  $('toggleCurrentProfilePassword').textContent = 'Ver';
  $('toggleNewProfilePassword').textContent = 'Ver';
  $('toggleConfirmProfilePassword').textContent = 'Ver';
  $('passwordStrengthDot').className = 'password-strength-dot';
  $('passwordStrengthText').textContent = 'Usa al menos 10 caracteres, letras y números.';

  $('profilePasswordMessage').textContent = '';
  $('profilePasswordMessage').className =
    'profile-message';

  $('profileModal').classList.remove('hidden');

  document.body.classList.add('no-scroll');
}

function closeProfileModal(){
  if(CURRENT_USER?.mustChangePassword){
    setProfileMessage('Debes cambiar la contraseña temporal antes de continuar.','error');
    return;
  }
  $('profileModal').classList.add('hidden');
  document.body.classList.remove('no-scroll');
}
$('profileBtn').addEventListener(
  'click',
  openProfileModal
);

$('closeProfileModal').addEventListener(
  'click',
  closeProfileModal
);

$('profileModal').addEventListener('click', e => {

  if(e.target.id === 'profileModal'){
    closeProfileModal();
  }

});
document.addEventListener('keydown', e => {

  if(
    e.key === 'Escape' &&
    !$('profileModal').classList.contains('hidden')
  ){
    closeProfileModal();
  }

});
function processProfileImage(file){

  return new Promise((resolve, reject) => {

    const allowed = [
      'image/jpeg',
      'image/png',
      'image/webp'
    ];

    if(!allowed.includes(file.type)){
      reject(
        new Error(
          'Selecciona una imagen JPG, PNG o WEBP.'
        )
      );
      return;
    }

    if(file.size > 5 * 1024 * 1024){
      reject(
        new Error(
          'La fotografía no puede superar los 5 MB.'
        )
      );
      return;
    }

    const reader = new FileReader();

    reader.onload = event => {

      const img = new Image();

      img.onload = () => {

        const canvas =
          document.createElement('canvas');

        const size = 320;

        canvas.width = size;
        canvas.height = size;

        const ctx = canvas.getContext('2d');

        const cropSize =
          Math.min(img.width, img.height);

        const sx =
          (img.width - cropSize) / 2;

        const sy =
          (img.height - cropSize) / 2;

        ctx.drawImage(
          img,
          sx,
          sy,
          cropSize,
          cropSize,
          0,
          0,
          size,
          size
        );

        const optimizedImage =
          canvas.toDataURL(
            'image/jpeg',
            0.82
          );

        resolve(optimizedImage);
      };

      img.onerror = () => {
        reject(
          new Error(
            'No fue posible procesar la imagen.'
          )
        );
      };

      img.src = event.target.result;
    };

    reader.onerror = () => {
      reject(
        new Error(
          'No fue posible leer la imagen.'
        )
      );
    };

    reader.readAsDataURL(file);

  });

}
$('changeProfileImageBtn').addEventListener(
  'click',
  () => {

    $('profileImageInput').click();

  }
);
$('profileImageInput').addEventListener('change', async e => {
  const file=e.target.files[0];
  if(!file) return;
  try{
    const image=await processProfileImage(file);
    const data=await apiFetch('/api/profile/photo',{method:'POST',body:JSON.stringify({profile_image:image})});
    const updatedUser={...CURRENT_USER,profileImage:data.profileImage||image};
    syncCurrentUser(updatedUser);
    renderUserAvatar($('profileAvatarPreview'),updatedUser);
    renderUserAvatar($('sessionAvatar'),updatedUser);
    showToast('Foto de perfil actualizada.','success');
  }catch(error){
    showToast(error.message||'No fue posible actualizar la fotografía.','error');
  }
  e.target.value='';
});

$('removeProfileImageBtn').addEventListener('click', async ()=>{
  try{
    await apiFetch('/api/profile/photo',{method:'DELETE'});
    const updatedUser={...CURRENT_USER,profileImage:''};
    syncCurrentUser(updatedUser);
    renderUserAvatar($('profileAvatarPreview'),updatedUser);
    renderUserAvatar($('sessionAvatar'),updatedUser);
    showToast('Foto de perfil eliminada.','success');
  }catch(error){
    showToast(error.message||'No fue posible eliminar la fotografía.','error');
  }
});


function setProfileMessage(message='', type=''){
  const target = $('profilePasswordMessage');
  target.textContent = message;
  target.className = `profile-message ${type}`.trim();
}

function togglePasswordVisibility(inputId, buttonId){
  const input = $(inputId);
  const button = $(buttonId);
  if(!input || !button) return;

  input.type = input.type === 'password' ? 'text' : 'password';
  button.textContent = input.type === 'password' ? 'Ver' : 'Ocultar';
}

$('toggleCurrentProfilePassword').addEventListener('click',()=>
  togglePasswordVisibility('currentProfilePassword','toggleCurrentProfilePassword')
);
$('toggleNewProfilePassword').addEventListener('click',()=>
  togglePasswordVisibility('newProfilePassword','toggleNewProfilePassword')
);
$('toggleConfirmProfilePassword').addEventListener('click',()=>
  togglePasswordVisibility('confirmProfilePassword','toggleConfirmProfilePassword')
);

$('newProfilePassword').addEventListener('input', e => {
  const value = e.target.value;
  const dot = $('passwordStrengthDot');
  const textLabel = $('passwordStrengthText');

  if(!value){
    dot.className = 'password-strength-dot';
    textLabel.textContent = 'Usa al menos 10 caracteres, letras y números.';
    return;
  }

  const checks = [
    value.length >= 10,
    /[a-zA-Z]/.test(value),
    /\d/.test(value),
    /[^a-zA-Z0-9]/.test(value)
  ].filter(Boolean).length;

  if(value.length < 10 || checks <= 2){
    dot.className = 'password-strength-dot weak';
    textLabel.textContent = 'Contraseña débil. Combina letras y números.';
  }else if(checks === 3){
    dot.className = 'password-strength-dot medium';
    textLabel.textContent = 'Contraseña adecuada.';
  }else{
    dot.className = 'password-strength-dot strong';
    textLabel.textContent = 'Contraseña fuerte.';
  }
});

$('changePasswordForm').addEventListener('submit', async e => {
  e.preventDefault();
  setProfileMessage();
  const currentPassword=$('currentProfilePassword').value;
  const newPassword=$('newProfilePassword').value;
  const confirmPassword=$('confirmProfilePassword').value;

  if(newPassword.length<10 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)){
    setProfileMessage('La nueva contraseña debe tener al menos 10 caracteres, letras y números.','error');
    return;
  }
  if(newPassword!==confirmPassword){
    setProfileMessage('La nueva contraseña y su confirmación no coinciden.','error');
    return;
  }
  try{
    await apiFetch('/api/profile/change-password',{
      method:'POST',
      body:JSON.stringify({current_password:currentPassword,new_password:newPassword})
    });
    CURRENT_USER={...CURRENT_USER,mustChangePassword:false};
    $('currentProfilePassword').value='';
    $('newProfilePassword').value='';
    $('confirmProfilePassword').value='';
    $('passwordStrengthDot').className='password-strength-dot';
    $('passwordStrengthText').textContent='Usa al menos 10 caracteres, letras y números.';
    setProfileMessage('Contraseña actualizada correctamente.','success');
    showToast('Contraseña actualizada correctamente.','success');
  }catch(error){
    setProfileMessage(error.message||'No fue posible actualizar la contraseña.','error');
  }
});

const registerForm = $('registerForm');
const registerError = $('registerError');
const registerSuccess = $('registerSuccess');
function showRegister(){
  loginForm.classList.add('hidden');
  registerForm.classList.remove('hidden');
  loginScreen.classList.add('register-mode');
  registerError.textContent='';
  registerSuccess.textContent='';
  setTimeout(()=>$('registerDpi')?.focus(),180);
}
function showLogin(){
  registerForm.classList.add('hidden');
  loginForm.classList.remove('hidden');
  loginScreen.classList.remove('register-mode');
  registerError.textContent='';
  registerSuccess.textContent='';
  setTimeout(()=>$('loginUser')?.focus(),180);
}

function populateAgencySelect(){
  const select=$('registerAgency');
  if(!select) return;
  const current=select.value;
  select.innerHTML='<option value="">Selecciona tu agencia</option>';
  AGENCIES.forEach(agency=>{
    const option=document.createElement('option');
    option.value=agency.id;
    option.textContent=agency.name;
    select.appendChild(option);
  });
  if([...select.options].some(o=>o.value===current)) select.value=current;
}

$('openRegisterBtn').addEventListener('click', showRegister);
$('backToLoginBtn').addEventListener('click', showLogin);
$('toggleRegisterPassword').addEventListener('click',()=>{ const input=$('registerPassword'); input.type=input.type==='password'?'text':'password'; $('toggleRegisterPassword').textContent=input.type==='password'?'Ver':'Ocultar'; });

registerForm.addEventListener('submit', async e=>{
  e.preventDefault();
  registerError.textContent=''; registerSuccess.textContent='';
  const dpi=$('registerDpi').value.replace(/\D/g,'');
  const name=$('registerName').value.trim().replace(/\s+/g,' ');
  const agencyId=$('registerAgency').value;
  const username=$('registerUser').value.trim().toLowerCase();
  const password=$('registerPassword').value;
  const confirmPassword=$('registerPasswordConfirm').value;
  if(!/^\d{13}$/.test(dpi)){ registerError.textContent='El DPI debe contener 13 dígitos.'; return; }
  if(name.length<5){ registerError.textContent='Ingresa tu nombre completo.'; return; }
  if(!agencyId){ registerError.textContent='Selecciona tu agencia.'; return; }
  if(!/^[a-z0-9._-]{4,60}$/.test(username)){ registerError.textContent='El usuario debe tener entre 4 y 60 caracteres.'; return; }
  if(password.length<10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)){ registerError.textContent='La contraseña debe tener al menos 10 caracteres, letras y números.'; return; }
  if(password!==confirmPassword){ registerError.textContent='Las contraseñas no coinciden.'; return; }
  try{
    await apiFetch('/api/auth/register',{
      method:'POST',
      body:JSON.stringify({dpi,name,agency_id:agencyId,username,password})
    });
    registerSuccess.textContent='Cuenta creada correctamente. Ya puedes iniciar sesión.';
    $('loginUser').value=username;
    $('loginPassword').value='';
    registerForm.reset();
    setTimeout(showLogin,900);
  }catch(error){
    registerError.textContent=error.message||'No fue posible crear la cuenta.';
  }
});

$('togglePassword').addEventListener('click',()=>{ const input=$('loginPassword'); input.type=input.type==='password'?'text':'password'; $('togglePassword').textContent=input.type==='password'?'Ver':'Ocultar'; });
$('logoutBtn').addEventListener('click',async ()=>{
  try{ await apiFetch('/api/auth/logout',{method:'POST'}); }catch{}
  clearCurrentUser();
  appShell.classList.add('hidden');
  loginScreen.classList.remove('hidden');
  showLogin();
  $('loginPassword').value='';
});

function addMessage(text,sender='bot'){
  const row=document.createElement('div'); row.className=`message-row ${sender}`;
  const avatar=document.createElement('div'); avatar.className='message-avatar'; avatar.textContent=sender==='bot'?'AI':'TÚ';
  const bubble=document.createElement('div'); bubble.className='message-bubble';
  bubble.innerHTML=`${escapeHtml(text).replace(/\n/g,'<br>')}<span class="message-meta">${sender==='bot'?'Asistente COLUA':'Tú'} · ${currentTime()}</span>`;
  row.append(avatar,bubble); messages.appendChild(row); messages.scrollTop=messages.scrollHeight;
}
function showTyping(callback){ const row=document.createElement('div'); row.className='message-row bot'; row.innerHTML='<div class="message-avatar">AI</div><div class="message-bubble typing"><i></i><i></i><i></i></div>'; messages.appendChild(row); messages.scrollTop=messages.scrollHeight; setTimeout(()=>{row.remove();callback();},650); }
function showPersistentTyping(){
  const row=document.createElement('div');
  row.className='message-row bot rag-typing-row';
  row.innerHTML='<div class="message-avatar">AI</div><div class="message-bubble typing"><i></i><i></i><i></i></div>';
  messages.appendChild(row);
  messages.scrollTop=messages.scrollHeight;
  return row;
}


function safeSourceUrl(source){
  const raw=String(source||'').split('|')[0].trim();
  if(!/^https:\/\//i.test(raw)) return '';
  try{
    const url=new URL(raw);
    return ['coluarl.com.gt','www.coluarl.com.gt'].includes(url.hostname) ? url.href : '';
  }catch{
    return '';
  }
}

function addRagSources(sources=[]){
  if(!Array.isArray(sources) || !sources.length) return;
  const unique=[];
  const seen=new Set();
  sources.forEach(source=>{
    const key=`${source.title||''}|${source.source||''}`;
    if(seen.has(key)) return;
    seen.add(key);
    unique.push(source);
  });
  if(!unique.length) return;

  const row=document.createElement('div');
  row.className='rag-source-row';
  const label=document.createElement('span');
  label.className='rag-source-label';
  label.textContent='Fuentes consultadas';
  row.appendChild(label);

  const chips=document.createElement('div');
  chips.className='rag-source-chips';
  unique.slice(0,3).forEach(source=>{
    const url=safeSourceUrl(source.source);
    const element=document.createElement(url ? 'a' : 'span');
    element.className='rag-source-chip';
    element.textContent=source.title || source.section || 'Base COLUA';
    if(url){
      element.href=url;
      element.target='_blank';
      element.rel='noopener noreferrer';
    }
    chips.appendChild(element);
  });
  row.appendChild(chips);
  messages.appendChild(row);
  messages.scrollTop=messages.scrollHeight;
}

async function checkRagStatus(){
  const label=$('ragStatusText');
  const line=$('ragStatusLine');
  if(!label) return;
  try{
    const data=await apiFetch(RAG_STATUS_URL,{cache:'no-store'});
    label.textContent=`RAG en nube conectado · ${data.documents||0} fuentes · ${data.provider||'LLM'}`;
    if(line) line.classList.remove('rag-offline');
  }catch{
    label.textContent='RAG en nube no disponible';
    if(line) line.classList.add('rag-offline');
  }
}

async function queryRag(message){
  const data=await apiFetch(RAG_API_URL,{
    method:'POST',
    body:JSON.stringify({
      message,
      conversation_id:CHAT_CONVERSATION_ID
    })
  });
  CHAT_CONVERSATION_ID=data.conversationId||CHAT_CONVERSATION_ID;
  return data;
}

function ragFallbackAnswer(){
  return {
    answer:'El servicio de inteligencia artificial no está disponible temporalmente. Para evitar darte información incorrecta, intenta nuevamente en unos minutos o consulta a un asesor de COLUA.',
    topic:'otros'
  };
}

function applyRagActions(data, topic){
  if(data?.action==='start_prequalification' || topic==='precalificacion'){
    addActionButtons([
      {label:'Iniciar precalificación',primary:true,onClick:startPrequalification},
      {label:'Hablar con COLUA',onClick:()=>showColuaContactOptions('la precalificación de crédito')}
    ]);
    return;
  }
  if(data?.action==='show_agencies'){
    addActionButtons([
      {label:'Ver agencias',primary:true,onClick:openAgencyDirectory},
      {label:`Llamar al ${CONTACT_PHONE}`,onClick:()=>callPhone(CONTACT_PHONE)}
    ]);
    return;
  }
  serviceActions(topic);
}

async function answerWithRag(text, topicHint=null){
  const topic=topicHint||classify(text);
  registerQuery(topic,text);
  const typing=showPersistentTyping();
  try{
    const data=await queryRag(text);
    typing.remove();
    addMessage(data.answer,'bot');
    addRagSources(data.sources);
    applyRagActions(data,topic);
  }catch(error){
    typing.remove();
    const fallback=ragFallbackAnswer();
    addMessage(fallback.answer,'bot');
    if(typeof showToast==='function') showToast(error.message||'RAG no disponible.','error');
  }
}

function setQuickActions(){
  quickActions.innerHTML='';
  const actions=[
    ['Precalificar crédito','prequal'],
    ['Tipos de crédito','prestamos'],
    ['Requisitos de crédito','requisitosCredito'],
    ['Proceso de crédito','procesoCredito'],
    ['Ahorros','ahorros'],
    ['Contacto','contacto']
  ];
  actions.forEach(([label,topic])=>{
    const b=document.createElement('button'); b.type='button'; b.className='quick-action'; b.textContent=label;
    b.addEventListener('click',()=> topic==='prequal' ? startPrequalification() : answerTopic(topic));
    quickActions.appendChild(b);
  });
}

function registerQuery(topic,text){
  // Las consultas se registran automáticamente en el backend junto con la conversación.
}
async function answerTopic(topic){
  const item=knowledge[topic]; if(!item)return;
  addMessage(item.question,'user');
  await answerWithRag(item.question,topic);
}

function classify(text){
  const n=text.toLowerCase();
  if(/precalific|calificar.*cr[eé]dito|puedo optar|quiero saber si.*cr[eé]dito/.test(n))return'precalificacion';
  if(/requisito|documento|papel/.test(n) && /pr[eé]stamo|cr[eé]dito/.test(n))return'requisitosCredito';
  if(/proceso|paso|c[oó]mo solicitar|solicitud/.test(n) && /pr[eé]stamo|cr[eé]dito/.test(n))return'procesoCredito';
  if(/pr[eé]stamo|cr[eé]dito|financiamiento|vivienda|agr[ií]cola|consumo/.test(n))return'prestamos';
  if(/asoci|dpi|recibo|aportaci[oó]n/.test(n))return'asociarme';
  if(/ahorro|cuenta|plazo fijo|programado/.test(n))return'ahorros';
  if(/remesa|extranjero/.test(n))return'remesas';
  if(/tarjeta|d[eé]bito|visa/.test(n))return'tarjetas';
  if(/contact|tel[eé]fono|agencia|ubicaci[oó]n|direcci[oó]n|horario/.test(n))return'contacto';
  if(/colua|historia|instituci[oó]n|fundad|micoope/.test(n))return'institucional';
  return'otros';
}

let prequal = null;
const PREQUAL_STEPS = [
  {
    key:'consent',
    label:'Comenzar',
    prompt:'¿Comenzamos con tu precalificación?'
  },

  {
    key:'income',
    label:'Ingresos mensuales',
    prompt:'Para comenzar, ¿cuáles son aproximadamente tus ingresos mensuales? Puedes indicarme el monto en quetzales, por ejemplo: Q5,000.'
  },

  {
    key:'employment',
    label:'Situación laboral',
    prompt:'Ahora cuéntame un poco sobre tu actividad laboral. ¿Trabajas en relación de dependencia, tienes negocio propio, realizas alguna actividad agrícola u otra actividad?'
  },

  {
    key:'tenure',
    label:'Antigüedad laboral',
    prompt:'¿Cuánto tiempo llevas en tu empleo o actividad económica actual? Puedes indicármelo en meses, por ejemplo: 24 meses.'
  },

  {
    key:'debts',
    label:'Obligaciones financieras',
    prompt:'¿Actualmente pagas préstamos, créditos, tarjetas u otras obligaciones financieras? Indícame aproximadamente cuánto pagas al mes. Si no tienes ninguna, puedes escribir 0.'
  },

  {
    key:'expenses',
    label:'Gastos mensuales',
    prompt:'Además de esas obligaciones, ¿cuánto gastas aproximadamente al mes en alimentación, vivienda, servicios, transporte y otros gastos personales o familiares?'
  },

  {
    key:'amount',
    label:'Monto solicitado',
    prompt:'Muy bien. Ahora hablemos del crédito que necesitas. ¿Qué monto aproximado deseas solicitar?'
  },

  {
    key:'term',
    label:'Plazo deseado',
    prompt:'¿En cuánto tiempo aproximadamente te gustaría pagar el crédito? Puedes indicarme el número de meses, por ejemplo: 12, 24, 36 o 48.'
  },

  {
    key:'purpose',
    label:'Destino del crédito',
    prompt:'¿Para qué deseas utilizar el crédito? Por ejemplo: vivienda, negocio, vehículo, agricultura, gastos personales u otro propósito.'
  },

  {
    key:'arrears',
    label:'Comportamiento de pago',
    prompt:'Para conocer un poco mejor tu situación actual, ¿tienes alguna cuota de préstamo o crédito que se encuentre atrasada en este momento?'
  },

  {
    key:'phone',
    label:'Teléfono de contacto',
    prompt:'Ya casi terminamos. ¿Cuál es el número de teléfono donde un asesor de COLUA podría comunicarse contigo? Ingresa los 8 dígitos.'
  },

  {
    key:'contactPreference',
    label:'Medio de contacto',
    prompt:'Por último, ¿cómo prefieres que te contactemos: por llamada, WhatsApp o cualquiera de las dos opciones?'
  }
];

function parseMoney(text){
  const clean=String(text).replace(/q/ig,'').replace(/,/g,'').replace(/\s/g,'');
  const match=clean.match(/-?\d+(?:\.\d{1,2})?/);
  return match ? Number(match[0]) : NaN;
}
function parseInteger(text){ const match=String(text).match(/\d+/); return match ? Number(match[0]) : NaN; }
function isYes(text){ return /^(s[ií]|si|sí|acepto|continuar|de acuerdo)$/i.test(text.trim()); }
function isNo(text){ return /^(no|cancelar|no deseo)$/i.test(text.trim()); }
function parseContactPreference(text){
  const value=normalizeText(text);
  if(/whats?app/.test(value)) return 'WhatsApp';
  if(/ambos|ambas|cualquiera/.test(value)) return 'Llamada y WhatsApp';
  if(/llamada|telefono|telefonica/.test(value)) return 'Llamada';
  return '';
}

function updatePrequalStatus(){
  const box=$('prequalStatus');
  if(!prequal){ box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const index=Math.min(prequal.step,PREQUAL_STEPS.length-1);
  $('prequalStepLabel').textContent=`Paso ${index+1} de ${PREQUAL_STEPS.length}`;
  $('prequalStepText').textContent=PREQUAL_STEPS[index].label;
  $('prequalProgressBar').style.width=`${Math.round((index/PREQUAL_STEPS.length)*100)}%`;
}

function startPrequalification(){
  const user=currentUser();
  const firstName=(user?.name || '').trim().split(/\s+/)[0] || '';

  prequal={
    step:0,
    data:{},
    startedAt:currentDateTime()
  };

  showSection('prequal');

  registerQuery(
    'precalificacion',
    'Inicio de precalificación crediticia'
  );

  addMessage(
    'Quiero realizar una precalificación de crédito.',
    'user'
  );

  updatePrequalStatus();

  const intro=
    `${firstName ? `Perfecto, ${firstName}. ` : 'Perfecto. '}`+
    `Voy a acompañarte durante el proceso. Te haré algunas preguntas sobre `+
    `tus ingresos, gastos y el crédito que deseas solicitar para realizar `+
    `una evaluación preliminar.\n\n`+
    `La información que obtengamos será únicamente orientativa y no representa `+
    `una aprobación definitiva del crédito.\n\n`+
    `¿Comenzamos?`;

  showTyping(()=>{
    addMessage(intro,'bot');
  });
}

function cancelPrequalification(message=true){
  prequal=null; updatePrequalStatus();
  if(message) addMessage('La precalificación fue cancelada. Puedes iniciar otra cuando lo desees o realizar una consulta sobre créditos.','bot');
}

function buildPrequalTransition(completedStep, data, nextStep){

  let confirmation='';

  switch(completedStep.key){

    case 'consent':
      confirmation=
        'Excelente. Empecemos con algunos datos sobre tu situación económica.';
      break;

    case 'income':
      confirmation=
        `Perfecto, tomaré como referencia ingresos mensuales aproximados de ${formatMoney(data.income)}.`;
      break;

    case 'employment':
      confirmation=
        `Entendido, registré tu actividad laboral como: ${data.employment}.`;
      break;

    case 'tenure':
      confirmation=
        `Muy bien, tienes aproximadamente ${data.tenure} meses en tu actividad actual.`;
      break;

    case 'debts':
      confirmation=data.debts>0
        ? `Gracias. Tomaré en cuenta que actualmente destinas aproximadamente ${formatMoney(data.debts)} al mes a obligaciones financieras.`
        : 'Perfecto, registré que actualmente no reportas pagos mensuales por otras obligaciones financieras.';
      break;

    case 'expenses':
      confirmation=
        `Entendido. Consideraré aproximadamente ${formatMoney(data.expenses)} de gastos mensuales.`;
      break;

    case 'amount':
      confirmation=
        `Muy bien, estás considerando solicitar aproximadamente ${formatMoney(data.amount)}.`;
      break;

    case 'term':
      confirmation=
        `Perfecto, tomaré ${data.term} meses como el plazo que tienes en mente.`;
      break;

    case 'purpose':
      confirmation=
        `Entendido, el crédito sería destinado a ${data.purpose}.`;
      break;

    case 'arrears':
      confirmation=data.arrears
        ? 'Gracias por indicarlo. Tomaremos en cuenta que actualmente reportas una cuota en atraso dentro de la evaluación preliminar.'
        : 'Perfecto, registré que actualmente no reportas cuotas de crédito en atraso.';
      break;

    case 'phone':
      confirmation=
        'Gracias. Ya registré tu número de contacto.';
      break;

    default:
      confirmation='Perfecto.';
  }

  return `${confirmation}\n\n${nextStep.prompt}`;
}

async function processPrequalificationAnswer(text){
  if(!prequal) return false;
  const step=PREQUAL_STEPS[prequal.step];
  let valid=true, error='';

  switch(step.key){
    case 'consent':
      if(isNo(text)){ cancelPrequalification(false); showTyping(()=>addMessage('Entendido. No continuaré con la precalificación. Si necesitas orientación general sobre créditos, puedo ayudarte.','bot')); return true; }
      if(!isYes(text)){ valid=false; error='Para continuar, responde Sí. Si no deseas seguir, responde No.'; }
      else prequal.data.consent=true;
      break;
    case 'income': {
      const v=parseMoney(text); if(!Number.isFinite(v)||v<=0){ valid=false; error='Ingresa un monto válido de ingresos mensuales. Ejemplo: 5000.'; } else prequal.data.income=v; break;
    }
    case 'employment':
      if(text.trim().length<3){ valid=false; error='Indica brevemente tu situación laboral actual.'; } else prequal.data.employment=text.trim();
      break;
    case 'tenure': {
      const v=parseInteger(text); if(!Number.isFinite(v)||v<0||v>720){ valid=false; error='Ingresa la antigüedad en meses. Ejemplo: 24.'; } else prequal.data.tenure=v; break;
    }
    case 'debts': {
      const v=parseMoney(text); if(!Number.isFinite(v)||v<0){ valid=false; error='Ingresa un monto válido de obligaciones mensuales. Si no tienes, escribe 0.'; } else prequal.data.debts=v; break;
    }
    case 'expenses': {
    const v=parseMoney(text);

    if(!Number.isFinite(v)||v<0){
      valid=false;
      error='Ingresa un monto válido de gastos mensuales. Si no tienes gastos adicionales, escribe 0.';
    } else {
      prequal.data.expenses=v;
    }

    break;
  }
    case 'amount': {
      const v=parseMoney(text); if(!Number.isFinite(v)||v<=0){ valid=false; error='Ingresa un monto solicitado válido. Ejemplo: 15000.'; } else prequal.data.amount=v; break;
    }
    case 'term': {
      const v=parseInteger(text);

      if(!Number.isFinite(v)||v<=0||v>360){
        valid=false;
        error='Ingresa un plazo válido expresado en meses. Ejemplo: 12, 24, 36 o 48.';
      } else {
        prequal.data.term=v;
      }

      break;
    }
    case 'purpose':
      if(text.trim().length<3){ valid=false; error='Indica brevemente el destino que tendría el crédito.'; } else prequal.data.purpose=text.trim();
      break;
    case 'arrears':
      if(!isYes(text) && !isNo(text)){ valid=false; error='Responde Sí o No según corresponda.'; }
      else prequal.data.arrears=isYes(text);
      break;
    case 'phone': {
      const phone=digitsOnly(text);
      if(phone.length!==8){ valid=false; error='Ingresa un número de teléfono válido de 8 dígitos.'; }
      else prequal.data.phone=phone;
      break;
    }
    case 'contactPreference': {
      const preference=parseContactPreference(text);
      if(!preference){ valid=false; error='Indica Llamada, WhatsApp o Ambos.'; }
      else prequal.data.contactPreference=preference;
      break;
    }
  }

  if(!valid){ showTyping(()=>addMessage(error,'bot')); return true; }

  const completedStep=step;

  prequal.step++;

  if(prequal.step < PREQUAL_STEPS.length){

    updatePrequalStatus();

    const nextStep=PREQUAL_STEPS[prequal.step];

    const conversationalMessage=
      buildPrequalTransition(
        completedStep,
        prequal.data,
        nextStep
      );

    showTyping(()=>{
      addMessage(conversationalMessage,'bot');
    });

  } else {

    showTyping(()=>{
      addMessage(
        '¡Listo! Ya tengo la información necesaria. Dame un momento para preparar el resultado de tu precalificación.',
        'bot'
      );
    });

    await completePrequalification();
  }

  return true;

}

async function completePrequalification(){
  const data=prequal.data;

  try{
    const result=await apiFetch('/api/prequalifications',{
      method:'POST',
      body:JSON.stringify({
        phone:data.phone,
        contact_preference:data.contactPreference,
        income:data.income,
        employment:data.employment,
        tenure_months:data.tenure,
        debts:data.debts,

        // Nuevos datos enviados al backend
        expenses:data.expenses || 0,
        desired_term_months:data.term || null,

        requested_amount:data.amount,
        purpose:data.purpose,
        arrears:data.arrears
      })
    });

    const requestId=result.code;

    const available=Number(result.available||0);
    const ratio=Number(result.debtRatio||0);
    const totalCommitments=Number(result.totalCommitments||0);
    const netCapacity=Number(result.netCapacity||0);
    const commitmentRatio=Number(result.commitmentRatio||0);

    const status=
      result.preliminaryResult ||
      'Perfil listo para revisión institucional';

    const observations=Array.isArray(result.observations)
      ? result.observations
      : [];

    let summary=
      `PRECALIFICACIÓN PRELIMINAR COMPLETADA\n\n`+

      `RESUMEN DE TU INFORMACIÓN\n`+
      `Ingresos mensuales: ${formatMoney(data.income)}\n`+
      `Situación laboral: ${data.employment}\n`+
      `Antigüedad: ${data.tenure} meses\n`+
      `Obligaciones financieras: ${formatMoney(data.debts)}\n`+
      `Gastos mensuales declarados: ${formatMoney(data.expenses || 0)}\n\n`+

      `SOLICITUD\n`+
      `Monto solicitado: ${formatMoney(data.amount)}\n`+
      `Plazo deseado: ${data.term || 'No indicado'} meses\n`+
      `Destino: ${data.purpose}\n\n`+

      `ANÁLISIS ORIENTATIVO\n`+
      `Total de compromisos mensuales declarados: ${formatMoney(totalCommitments)}\n`+
      `Capacidad disponible estimada: ${formatMoney(netCapacity)}\n`+
      `Carga financiera actual: ${ratio.toFixed(1)}% de tus ingresos\n`+
      `Compromiso total declarado: ${commitmentRatio.toFixed(1)}% de tus ingresos\n\n`+

      `RESULTADO PRELIMINAR\n`+
      `${status}\n`;

    if(observations.length){
      summary+=`\nASPECTOS IDENTIFICADOS\n`;

      observations.forEach((observation,index)=>{
        summary+=`${index+1}. ${observation}\n`;
      });
    }

    summary+=
      `\nSEGUIMIENTO\n`+
      `Código de solicitud: ${requestId}\n`+
      `Contacto: ${formatPhone(data.phone)} · ${data.contactPreference}\n\n`+

      `Importante: esta evaluación es únicamente orientativa. `+
      `No representa aprobación o rechazo de un crédito. `+
      `El monto, tasa, plazo, cuota, requisitos y aprobación final deben ser evaluados por personal autorizado de COLUA.`;

    prequal=null;

    updatePrequalStatus();

    $('prequalProgressBar').style.width='100%';

    await refreshPrequalifications();

    showTyping(()=>{

      addMessage(summary,'bot');

      const agency=currentAgencyContact();

      addMessage(
        agency
          ? `Tu solicitud ${requestId} quedó registrada para seguimiento de ${agency.name}. Un asesor podrá revisar la información completa de tu precalificación.`
          : `Tu solicitud ${requestId} quedó registrada para seguimiento. Un asesor podrá revisar la información completa de tu precalificación.`,
        'bot'
      );

      addActionButtons([
        ...(agency?.phones?.[0]?[{
          label:`Llamar a ${agency.name}`,
          primary:true,
          onClick:()=>callPhone(agency.phones[0])
        }]:[]),

        {
          label:'Ver agencias',
          onClick:openAgencyDirectory
        }
      ]);

    });

    renderAnalytics();

  }catch(error){

    showToast(
      error.message||'No fue posible registrar la precalificación.',
      'error'
    );

    addMessage( 
      'No pude registrar la precalificación en el servidor. Tus datos no se guardaron. Intenta nuevamente.',
      'bot'
    );
  }
}

function isPrequalSideQuestion(text){
  const n=normalizeText(text);
  return /[¿?]/.test(text) || /^(por que|para que|que significa|que es|como funciona|puedo|necesito saber|ayuda)\b/.test(n);
}

async function answerFreeText(text){
  if(prequal && /^(cancelar|salir|detener)( la)? precalific/i.test(text.trim())){
    cancelPrequalification(true);
    return;
  }

  if(prequal && isPrequalSideQuestion(text)){
    const currentStep=PREQUAL_STEPS[prequal.step];
    await answerWithRag(text);
    if(prequal && currentStep){
      showTyping(()=>addMessage(`Para continuar con tu precalificación: ${currentStep.prompt}`,'bot'));
    }
    return;
  }

  if(await processPrequalificationAnswer(text)) return;
  await answerWithRag(text);
}

function initialize(){
  prequal=null;
  CHAT_CONVERSATION_ID=null;

  updatePrequalStatus();
  checkRagStatus();

  messages.innerHTML='';

  const user=currentUser();
  const fullName=(user?.name || '').trim();

  // Utilizamos el primer nombre para hacer
  // el saludo más natural.
  const firstName=fullName
    ? fullName.split(/\s+/)[0]
    : '';

  const greeting=firstName
    ? `¡Hola, ${firstName}! Soy tu asistente virtual de COLUA.`
    : '¡Hola! Soy tu asistente virtual de COLUA.';

  const welcome=
    `${greeting}\n\n`+
    `Estoy aquí para orientarte sobre nuestros productos y servicios, `+
    `resolver tus consultas o acompañarte paso a paso en una precalificación de crédito.\n\n`+
    `¿Por dónde deseas comenzar?`;

  addMessage(welcome,'bot');

  setQuickActions();

  messageInput.value='';
  counter.textContent='0/300';
}


let activeRequestId=null;

function populateAdvisorAgencyFilter(){
  const select=$('advisorAgencyFilter');
  if(!select) return;
  const current=select.value;
  select.innerHTML='<option value="">Todas las agencias</option>';
  AGENCIES.forEach(agency=>{
    const option=document.createElement('option');
    option.value=agency.id;
    option.textContent=`${agency.name} · ${agency.department}`;
    select.appendChild(option);
  });
  if([...select.options].some(option=>option.value===current)) select.value=current;
}

function getStaffScopeRecords(){
  const user=currentUser();
  if(!user || !['asesor','administrador'].includes(user.role)) return [];
  return migratePrequalifications().filter(record=>canViewPrequalification(record,user));
}

async function renderAdvisorDashboard(){
  const section=$('advisorSection');
  if(!section) return;
  const user=currentUser();
  if(!user || !['asesor','administrador'].includes(user.role)) return;
  try{ await refreshPrequalifications(); }catch(error){ showToast(error.message||'No fue posible cargar las solicitudes.','error'); }

  populateAdvisorAgencyFilter();
  const allScope=getStaffScopeRecords();
  const isAdmin=user.role==='administrador';
  const agencyName=isAdmin ? 'Todas las agencias' : (user.agency||'Agencia no indicada');
  $('advisorAgencyName').textContent=agencyName;
  $('advisorAgencyHint').textContent=isAdmin ? 'Vista institucional completa' : 'Acceso limitado a tu agencia';
  $('advisorScopeText').textContent=isAdmin
    ? 'Supervisa las precalificaciones registradas en todas las agencias y su estado de seguimiento.'
    : `Consulta y da seguimiento únicamente a las precalificaciones asignadas a ${user.agency||'tu agencia'}.`;

  $('advisorTotalRequests').textContent=allScope.length;
  $('advisorPendingRequests').textContent=allScope.filter(q=>q.workflowStatus==='pendiente').length;
  $('advisorReviewRequests').textContent=allScope.filter(q=>q.workflowStatus==='en_revision').length;
  $('advisorContactedRequests').textContent=allScope.filter(q=>q.workflowStatus==='contactado').length;
  $('advisorDerivedRequests').textContent=allScope.filter(q=>q.workflowStatus==='derivado').length;

  const search=normalizeText($('advisorSearch')?.value||'');
  const status=$('advisorStatusFilter')?.value||'';
  const agencyFilter=isAdmin ? ($('advisorAgencyFilter')?.value||'') : '';
  const filtered=allScope.filter(q=>{
    if(status && q.workflowStatus!==status) return false;
    if(agencyFilter && q.agencyId!==agencyFilter) return false;
    if(!search) return true;
    return normalizeText([q.id,q.applicantName,q.username,q.phone,q.purpose,q.agency].join(' ')).includes(search);
  });

  const tbody=$('advisorRequestRows');
  tbody.innerHTML='';
  filtered.forEach(q=>{
    const tr=document.createElement('tr');
    tr.innerHTML=`
      <td><div class="request-id-cell"><strong>${escapeHtml(q.id)}</strong><small>${escapeHtml(q.agency)}</small></div></td>
      <td>${escapeHtml(q.createdAt)}</td>
      <td><div class="request-person-cell"><strong>${escapeHtml(q.applicantName)}</strong><small>@${escapeHtml(q.username)}</small></div></td>
      <td><div class="request-contact-cell"><strong>${escapeHtml(formatPhone(q.phone))}</strong><small>${escapeHtml(q.contactPreference)}</small></div></td>
      <td><strong>${escapeHtml(formatMoney(q.requestedAmount))}</strong></td>
      <td><span class="request-purpose-cell">${escapeHtml(q.purpose)}</span></td>
      <td><span class="workflow-badge ${workflowClass(q.workflowStatus)}">${escapeHtml(workflowLabel(q.workflowStatus))}</span></td>
      <td><button class="request-view-btn" type="button" data-request-id="${escapeHtml(q.id)}">Ver</button></td>`;
    tr.querySelector('.request-view-btn').addEventListener('click',()=>openRequestDetail(q.id));
    tbody.appendChild(tr);
  });
  $('advisorEmptyState').classList.toggle('hidden',filtered.length>0);
}

function renderRequestHistory(record){
  const target=$('detailHistory');
  if(!target) return;
  const history=Array.isArray(record.history) ? record.history : [];
  target.innerHTML='';
  if(!history.length){
    target.innerHTML='<div class="request-history-empty">Todavía no hay gestiones registradas.</div>';
    return;
  }
  history.slice(0,12).forEach(item=>{
    const row=document.createElement('div');
    row.className='request-history-item';
    row.innerHTML=`<span class="request-history-dot"></span><div><strong>${escapeHtml(item.action||workflowLabel(item.status))}</strong><p>${escapeHtml(item.note||'Sin observación adicional.')}</p><small>${escapeHtml(item.date||'')} · ${escapeHtml(item.user||'sistema')}</small></div>`;
    target.appendChild(row);
  });
}

async function openRequestDetail(requestId){
  try{
    const data=await apiFetch(`/api/prequalifications/${encodeURIComponent(requestId)}`);
    const record=normalizePrequalification(data.item);
    const index=PREQUAL_CACHE.findIndex(x=>x.id===record.id);
    if(index>=0) PREQUAL_CACHE[index]=record;
    else PREQUAL_CACHE.unshift(record);

    activeRequestId=record.id;
    $('detailRequestId').textContent=record.id;
    $('detailApplicantName').textContent=record.applicantName;
    $('detailUsername').textContent=`@${record.username}`;
    $('detailApplicantAvatar').textContent=(record.applicantName||'U').charAt(0).toUpperCase();
    $('detailAgency').textContent=record.agency;
    $('detailCreatedAt').textContent=record.createdAt;
    $('detailPhone').textContent=formatPhone(record.phone);
    $('detailContactPreference').textContent=record.contactPreference;
    $('detailIncome').textContent=formatMoney(record.income);
    $('detailDebts').textContent=formatMoney(record.debts);
    $('detailAvailable').textContent=formatMoney(record.available);
    $('detailDebtRatio').textContent=`${Number(record.debtRatio||0).toFixed(1)}%`;
    $('detailAmount').textContent=formatMoney(record.requestedAmount);
    $('detailArrears').textContent=record.arrears ? 'Sí' : 'No';
    $('detailEmployment').textContent=record.employment;
    $('detailTenure').textContent=`${record.tenure} meses`;
    $('detailPurpose').textContent=record.purpose;
    $('detailPreliminaryResult').textContent=record.preliminaryResult;
    $('detailUpdatedAt').textContent=`Última actualización: ${record.updatedAt}`;

    const badge=$('detailWorkflowBadge');
    badge.textContent=workflowLabel(record.workflowStatus);
    badge.className=`workflow-badge ${workflowClass(record.workflowStatus)}`;
    const statusSelect=$('detailWorkflowStatus');
    statusSelect.innerHTML='';
    WORKFLOW_STATUSES.forEach(status=>{
      const option=document.createElement('option');
      option.value=status.value; option.textContent=status.label; statusSelect.appendChild(option);
    });
    statusSelect.value=record.workflowStatus;
    $('detailAdvisorNotes').value=record.advisorNotes||'';
    $('detailNotesCount').textContent=String((record.advisorNotes||'').length);
    const phone=digitsOnly(record.phone);
    $('advisorCallApplicant').disabled=phone.length!==8;
    $('advisorWhatsappApplicant').disabled=phone.length!==8;
    renderRequestHistory(record);
    $('requestDetailModal').classList.remove('hidden');
    document.body.classList.add('no-scroll');
  }catch(error){
    showToast(error.message||'No fue posible abrir la solicitud.','error');
  }
}

function closeRequestDetail(){
  $('requestDetailModal').classList.add('hidden');
  activeRequestId=null;
  document.body.classList.remove('no-scroll');
}

function getActiveRequest(){
  if(!activeRequestId) return null;
  return migratePrequalifications().find(item=>item.id===activeRequestId)||null;
}

async function saveRequestFollowup(){
  if(!activeRequestId) return;
  try{
    await apiFetch(`/api/prequalifications/${encodeURIComponent(activeRequestId)}/followup`,{
      method:'PATCH',
      body:JSON.stringify({
        workflow_status:$('detailWorkflowStatus').value,
        advisor_notes:$('detailAdvisorNotes').value.trim()
      })
    });
    showToast('Seguimiento guardado correctamente.','success');
    await renderAdvisorDashboard();
    await renderAnalytics();
    await openRequestDetail(activeRequestId);
  }catch(error){
    showToast(error.message||'No fue posible guardar el seguimiento.','error');
  }
}

chatForm.addEventListener('submit',async e=>{
  e.preventDefault();
  const text=messageInput.value.trim(); if(!text)return;
  messageInput.value=''; counter.textContent='0/300';
  if(!prequal && /^(iniciar|comenzar|hacer|realizar).*precalific/i.test(text)){ startPrequalification(); return; }
  addMessage(text,'user');
  await answerFreeText(text);
});
messageInput.addEventListener('input',()=>counter.textContent=`${messageInput.value.length}/300`);
$('resetBtn') .addEventListener( 'click', startNewConversation );
$('cancelPrequalBtn').addEventListener('click',()=>cancelPrequalification(true));
$('focusChatBtn').addEventListener('click',()=>showSection('chat'));
$('historyBtn')?.addEventListener('click',async ()=>{ showSection('history'); await loadChatHistory(); });
$('newConversationHistoryBtn') ?.addEventListener( 'click', startNewConversation );
document.querySelector('[data-section="home"]').addEventListener('click',()=>showSection('home'));
$('analyticsBtn').addEventListener('click',()=>showSection('analytics'));
$('usersAdminBtn')?.addEventListener('click',()=>showSection('users'));
$('advisorDashboardBtn').addEventListener('click',()=>showSection('advisor'));
$('startChatBtn').addEventListener('click',()=>showSection('chat'));
$('prequalBtn').addEventListener('click',startPrequalification);
$('startPrequalHeroBtn').addEventListener('click',startPrequalification);
$('mobileMenu').addEventListener('click',()=>sidebar.classList.toggle('open'));

function showSection(section){

  const user=currentUser();

  const isAdmin=
    user?.role==='administrador';

  const isAdvisor=
    user?.role==='asesor';

  const isStaff=
    isAdmin || isAdvisor;


  // ==========================================
  // VALIDACIÓN DE PERMISOS
  // ==========================================

  if(
    ['analytics','users'].includes(section)
    && !isAdmin
  ){

    section=
      isAdvisor
        ? 'advisor'
        : 'home';

  }


  if(
    section==='advisor'
    && !isStaff
  ){

    section='home';

  }


  if(
    isAdvisor
    && section!=='advisor'
  ){

    section='advisor';

  }


  // ==========================================
  // MENÚ ACTIVO
  // ==========================================

  document
    .querySelectorAll('.nav-item')
    .forEach(item=>{

      item.classList.toggle(
        'active',
        item.dataset.section===section
      );

    });


  // ==========================================
  // PANTALLA INICIO
  // ==========================================

  const isHome=
    section==='home';

  $('homeSection')
    ?.classList.toggle(
      'hidden',
      !isHome
    );

  $('serviceStrip')
    ?.classList.toggle(
      'hidden',
      !isHome
    );

  $('homeActions')
    ?.classList.toggle(
      'hidden',
      !isHome
    );


  // ==========================================
  // CHAT / PRECALIFICACIÓN
  // ==========================================

  const isChat=
    section==='chat'
    || section==='prequal';

  $('chatSection')
    ?.classList.toggle(
      'hidden',
      !isChat
    );


  // ==========================================
  // HISTORIAL
  // ==========================================

  $('historySection')
    ?.classList.toggle(
      'hidden',
      section!=='history'
    );


  // ==========================================
  // ANALÍTICA
  // ==========================================

  $('analyticsSection')
    ?.classList.toggle(
      'hidden',
      section!=='analytics'
    );


  // ==========================================
  // ASESOR
  // ==========================================

  $('advisorSection')
    ?.classList.toggle(
      'hidden',
      section!=='advisor'
    );


  // ==========================================
  // USUARIOS
  // ==========================================

  $('userAdminSection')
    ?.classList.toggle(
      'hidden',
      section!=='users'
    );


  // ==========================================
  // NAVEGACIÓN / SCROLL
  // ==========================================

  if(isHome){

    $('homeSection')
      ?.scrollIntoView({
        behavior:'smooth',
        block:'start'
      });

  }


  if(isChat){

    $('chatSection')
      ?.scrollIntoView({
        behavior:'smooth',
        block:'start'
      });

    setTimeout(()=>{

      messageInput?.focus();

    },350);

  }


  if(section==='history'){

    $('historySection')
      ?.scrollIntoView({
        behavior:'smooth',
        block:'start'
      });

  }


  if(section==='analytics'){

    renderAnalytics();

    $('analyticsSection')
      ?.scrollIntoView({
        behavior:'smooth',
        block:'start'
      });

  }


  if(section==='advisor'){

    renderAdvisorDashboard();

    $('advisorSection')
      ?.scrollIntoView({
        behavior:'smooth',
        block:'start'
      });

  }


  if(section==='users'){

    renderAdminUsers();

    $('userAdminSection')
      ?.scrollIntoView({
        behavior:'smooth',
        block:'start'
      });

  }


  // Cerrar menú lateral en móvil

  sidebar.classList.remove('open');
}

document
  .querySelectorAll(
    '[data-home-action]'
  )
  .forEach(button=>{

    button.addEventListener(
      'click',
      async ()=>{

        const action=
          button.dataset.homeAction;


        // ====================================
        // PRECALIFICACIÓN
        // ====================================

        if(action==='prequal'){

          startPrequalification();

          return;

        }


        // ====================================
        // HISTORIAL
        // ====================================

        if(action==='history'){

          showSection('history');

          await loadChatHistory();

          return;

        }


        // ====================================
        // PRODUCTOS
        // ====================================

        if(action==='products'){

          showSection('chat');


          setTimeout(()=>{

            messageInput.value=
              'Quiero conocer los productos y servicios que ofrece COLUA.';


            counter.textContent=
              `${messageInput.value.length}/300`;


            messageInput.focus();

          },350);


          return;

        }


        // ====================================
        // CONSULTA GENERAL
        // ====================================

        if(action==='question'){

          showSection('chat');


          setTimeout(()=>{

            messageInput.value='';

            counter.textContent='0/300';

            messageInput.focus();

          },350);

        }

      }
    );

  });
async function loadChatHistory(){

  const container =
    $('chatHistoryList');

  if(!container){
    console.error(
      'No existe #chatHistoryList'
    );
    return;
  }


  // ==========================================
  // CARGANDO
  // ==========================================

  container.innerHTML=`

    <div class="history-state">

      <div class="history-state-icon">
        <svg viewBox="0 0 24 24">
          <path d="M4 5.5h16v11H9l-5 3v-14Z"/>
          <path d="M8 10h8M8 13h5"/>
        </svg>
      </div>

      <strong>
        Cargando tus conversaciones
      </strong>

      <span>
        Un momento, estamos consultando tu historial.
      </span>

    </div>

  `;


  try{

    const data =
      await apiFetch(
        '/api/chat/sessions'
      );


    console.log(
      'Historial recibido:',
      data
    );


    const conversations =
      Array.isArray(data?.conversations)
        ? data.conversations
        : [];


    // ==========================================
    // VACÍO
    // ==========================================

    if(conversations.length===0){

      container.innerHTML=`

        <div class="history-state">

          <div class="history-state-icon">
            <svg viewBox="0 0 24 24">
              <path d="M4 5.5h16v11H9l-5 3v-14Z"/>
              <path d="M8 10h8M8 13h5"/>
            </svg>
          </div>

          <strong>
            Aún no tienes conversaciones guardadas
          </strong>

          <span>
            Cuando realices una consulta con el asistente,
            aparecerá aquí para que puedas continuarla después.
          </span>

          <button
            type="button"
            class="history-primary-button"
            id="historyStartChatBtn"
          >
            Iniciar una conversación
          </button>

        </div>

      `;


      $('historyStartChatBtn')
        ?.addEventListener(
          'click',
          startNewConversation
        );


      return;
    }


    // ==========================================
    // CONVERSACIONES
    // ==========================================

    container.innerHTML='';


    conversations.forEach(
      conversation=>{

        const item =
          document.createElement('button');


        item.type='button';

        item.className=
          'history-conversation';


        // --------------------------------------
        // TÍTULO
        // --------------------------------------

        const title =
          (
            conversation.title
            || 'Conversación con el asistente'
          ).trim();


        // --------------------------------------
        // PREVIEW
        // --------------------------------------

        const preview =
          (
            conversation.preview
            || 'Continúa esta conversación con el asistente.'
          ).trim();


        // --------------------------------------
        // MENSAJES
        // --------------------------------------

        const count =
          Number(
            conversation.messageCount || 0
          );


        const countText =
          count===1
            ? '1 mensaje'
            : `${count} mensajes`;


        // --------------------------------------
        // FECHA
        // --------------------------------------

        let dateText =
          'Sin fecha';


        if(conversation.updatedAt){

          const date =
            new Date(
              conversation.updatedAt
            );


          if(
            !Number.isNaN(
              date.getTime()
            )
          ){

            dateText =
              date.toLocaleDateString(
                'es-GT',
                {
                  day:'2-digit',
                  month:'short',
                  year:'numeric'
                }
              );

          }

        }


        item.innerHTML=`

          <div class="history-conversation-icon">

            <svg viewBox="0 0 24 24">
              <path d="M4 5.5h16v11H9l-5 3v-14Z"/>
              <path d="M8 10h8M8 13h5"/>
            </svg>

          </div>


          <div class="history-conversation-info">

            <div class="history-conversation-top">

              <strong>
                ${escapeHtml(title)}
              </strong>

              <time>
                ${escapeHtml(dateText)}
              </time>

            </div>


            <p>
              ${escapeHtml(preview)}
            </p>


            <div class="history-conversation-bottom">

              <span>
                ${countText}
              </span>

              <span class="history-continue">
                Continuar conversación

                <svg viewBox="0 0 24 24">
                  <path d="m9 18 6-6-6-6"/>
                </svg>
              </span>

            </div>

          </div>

        `;


        item.addEventListener(
          'click',
          ()=>{

            openChatConversation(
              conversation.id
            );

          }
        );


        container.appendChild(
          item
        );

      }
    );


  }catch(error){

    console.error(
      'Error al cargar historial:',
      error
    );


    container.innerHTML=`

      <div class="history-state history-state-error">

        <div class="history-state-icon">

          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9"/>
            <path d="M12 8v5"/>
            <path d="M12 16h.01"/>
          </svg>

        </div>

        <strong>
          No pudimos cargar el historial
        </strong>

        <span>
          ${escapeHtml(
            error?.message
            || 'Ocurrió un problema al consultar tus conversaciones.'
          )}
        </span>

        <button
          type="button"
          class="history-primary-button"
          id="retryHistoryBtn"
        >
          Intentar nuevamente
        </button>

      </div>

    `;


    $('retryHistoryBtn')
      ?.addEventListener(
        'click',
        loadChatHistory
      );

  }

}
async function openChatConversation(
  conversationId
){

  if(!conversationId){
    return;
  }


  try{

    const data =
      await apiFetch(
        `/api/chat/sessions/${conversationId}`
      );


    const previousMessages =
      Array.isArray(data?.messages)
        ? data.messages
        : [];


    // ==========================================
    // CANCELAR PRECALIFICACIÓN ACTUAL
    // ==========================================

    prequal=null;

    updatePrequalStatus();


    // ==========================================
    // CONSERVAR CONVERSACIÓN
    // ==========================================

    CHAT_CONVERSATION_ID =
      data.conversationId;


    // ==========================================
    // LIMPIAR CHAT VISUAL
    // ==========================================

    messages.innerHTML='';


    // ==========================================
    // RESTAURAR MENSAJES
    // ==========================================

    previousMessages.forEach(
      message=>{

        const role =
          message.role==='assistant'
            ? 'bot'
            : 'user';


        addMessage(
          message.content,
          role
        );

      }
    );


    // ==========================================
    // SI ESTUVIERA VACÍA
    // ==========================================

    if(previousMessages.length===0){

      addMessage(
        'Esta conversación todavía no tiene mensajes. Puedes continuar escribiendo tu consulta.',
        'bot'
      );

    }


    // ==========================================
    // ABRIR CHAT
    // ==========================================

    showSection('chat');

    setQuickActions();


    setTimeout(()=>{

      messageInput.value='';

      counter.textContent='0/300';

      messageInput.focus();

      messages.scrollTop =
        messages.scrollHeight;

    },250);


  }catch(error){

    console.error(
      'Error abriendo conversación:',
      error
    );


    showToast(
      error?.message
      || 'No fue posible abrir la conversación.',
      'error'
    );

  }

}

function startNewConversation(){

  // El siguiente mensaje deberá crear
  // una nueva sesión en backend.

  CHAT_CONVERSATION_ID=null;

  prequal=null;

  updatePrequalStatus();

  messages.innerHTML='';


  const user =
    currentUser();


  const fullName =
    (
      user?.name || ''
    ).trim();


  const firstName =
    fullName
      ? fullName.split(/\s+/)[0]
      : '';


  const greeting =
    firstName
      ? `¡Hola, ${firstName}! `
      : '¡Hola! ';


  addMessage(
    `${greeting} Soy tu asistente virtual de COLUA.\n\n`+
    `Puedo ayudarte a resolver consultas sobre nuestros productos y servicios `+
    `o acompañarte en una precalificación de crédito.\n\n`+
    `¿Qué deseas consultar?`,
    'bot'
  );


  setQuickActions();

  showSection('chat');


  messageInput.value='';

  counter.textContent='0/300';


  setTimeout(
    ()=>messageInput.focus(),
    250
  );

}


async function renderAnalytics(){
  if(!CURRENT_USER || CURRENT_USER.role!=='administrador') return;
  try{
    const data=await apiFetch('/api/analytics/summary');
    $('totalQueries').textContent=data.totalQueries||0;
    $('totalSessions').textContent=data.totalSessions||0;
    $('totalPrequalifications').textContent=data.totalPrequalifications||0;
    if($('totalContinuations')) $('totalContinuations').textContent='—';
    $('topCategory').textContent='Consultas RAG';

    const bars=$('categoryBars');
    bars.innerHTML='';
    const totalTokens=Number(data.inputTokens||0)+Number(data.outputTokens||0);
    [
      ['Tokens de entrada',Number(data.inputTokens||0)],
      ['Tokens de salida',Number(data.outputTokens||0)]
    ].forEach(([label,value])=>{
      const pct=totalTokens?Math.round(value/totalTokens*100):0;
      const row=document.createElement('div'); row.className='bar-row';
      row.innerHTML=`<span class="bar-label">${label}</span><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div><span class="bar-value">${value}</span>`;
      bars.appendChild(row);
    });

    const agencyBars=$('agencyBars'); agencyBars.innerHTML='';
    const agencyEntries=data.byAgency||[];
    const maxAgency=Math.max(1,...agencyEntries.map(x=>Number(x.n||0)));
    if(!agencyEntries.length) agencyBars.innerHTML='<p class="empty-analytics">Todavía no hay datos por agencia.</p>';
    agencyEntries.forEach(item=>{
      const value=Number(item.n||0), pct=Math.round(value/maxAgency*100);
      const row=document.createElement('div'); row.className='bar-row';
      row.innerHTML=`<span class="bar-label">${escapeHtml(item.name)}</span><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div><span class="bar-value">${value}</span>`;
      agencyBars.appendChild(row);
    });

    const pbody=$('recentPrequalifications'); pbody.innerHTML='';
    (data.recentPrequalifications||[]).forEach(raw=>{
      const q=normalizePrequalification(raw);
      const tr=document.createElement('tr');
      tr.innerHTML=`<td>${escapeHtml(q.createdAt)}</td><td>${escapeHtml(q.applicantName)}</td><td>${escapeHtml(q.agency)}</td><td>${escapeHtml(formatMoney(q.requestedAmount))}</td><td>${escapeHtml(Number(q.debtRatio||0).toFixed(1)+'%')}</td><td><span class="workflow-badge ${workflowClass(q.workflowStatus)}">${escapeHtml(workflowLabel(q.workflowStatus))}</span></td>`;
      pbody.appendChild(tr);
    });
    if(!(data.recentPrequalifications||[]).length) pbody.innerHTML='<tr><td colspan="6">Todavía no hay precalificaciones completadas.</td></tr>';

    const tbody=$('recentQueries'); tbody.innerHTML='';
    (data.recentQueries||[]).forEach(q=>{
      const tr=document.createElement('tr');
      tr.innerHTML=`<td>${escapeHtml(q.date)}</td><td>${escapeHtml(q.user)}</td><td>${escapeHtml(q.agency||'No indicada')}</td><td>RAG</td><td>${escapeHtml(q.text)}</td>`;
      tbody.appendChild(tr);
    });
    if(!(data.recentQueries||[]).length) tbody.innerHTML='<tr><td colspan="5">Todavía no hay consultas registradas.</td></tr>';
  }catch(error){
    showToast(error.message||'No fue posible cargar la analítica.','error');
  }
}

$('clearAnalytics').addEventListener('click',()=>{
  showToast('En producción la auditoría no se elimina desde el navegador.','error');
});

$('advisorSearch').addEventListener('input',renderAdvisorDashboard);
$('advisorStatusFilter').addEventListener('change',renderAdvisorDashboard);
$('advisorAgencyFilter').addEventListener('change',renderAdvisorDashboard);
$('advisorRefreshBtn').addEventListener('click',()=>{ renderAdvisorDashboard(); showToast('Vista actualizada.','success'); });
$('advisorClearFilters').addEventListener('click',()=>{
  $('advisorSearch').value='';
  $('advisorStatusFilter').value='';
  $('advisorAgencyFilter').value='';
  renderAdvisorDashboard();
});
$('closeRequestDetail').addEventListener('click',closeRequestDetail);
$('requestDetailModal').addEventListener('click',e=>{ if(e.target.id==='requestDetailModal') closeRequestDetail(); });
$('detailAdvisorNotes').addEventListener('input',e=>{ $('detailNotesCount').textContent=String(e.target.value.length); });
$('saveRequestFollowup').addEventListener('click',saveRequestFollowup);
$('advisorCallApplicant').addEventListener('click',()=>{
  const record=getActiveRequest();
  if(record?.phone){ trackAction('asesor_llamada',record.id); callPhone(record.phone); }
});
$('advisorWhatsappApplicant').addEventListener('click',()=>{
  const record=getActiveRequest();
  if(record?.phone){
    trackAction('asesor_whatsapp',record.id);
    const number=`502${digitsOnly(record.phone)}`;
    openExternal(`https://wa.me/${number}?text=${encodeURIComponent(`Hola ${record.applicantName}, te contactamos de COLUA por tu precalificación ${record.id}.`)}`);
  }
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape' && !$('requestDetailModal').classList.contains('hidden')) closeRequestDetail();
});


$('closeAgencyModal').addEventListener('click',closeAgencyDirectory);
$('agencyModal').addEventListener('click',e=>{ if(e.target.id==='agencyModal') closeAgencyDirectory(); });
$('openOfficialAgencies').addEventListener('click',()=>{trackAction('redireccion_servicio','Directorio oficial de agencias');openExternal(SERVICE_LINKS.agencias);});
$('agencyWhatsappBtn')?.addEventListener('click',()=>openWhatsApp('una consulta general'));

function populateAdminAgencySelect(){
  const select=$('adminUserAgency');
  if(!select) return;
  const current=select.value;
  select.innerHTML='<option value="">Selecciona una agencia</option>';
  AGENCIES.forEach(agency=>{
    const option=document.createElement('option');
    option.value=agency.id;
    option.textContent=agency.name;
    select.appendChild(option);
  });
  if([...select.options].some(o=>o.value===current)) select.value=current;
}

async function renderAdminUsers(){
  if(!CURRENT_USER || CURRENT_USER.role!=='administrador' || !$('adminUsersRows')) return;
  populateAdminAgencySelect();
  try{
    const data=await apiFetch('/api/admin/users');
    const tbody=$('adminUsersRows');
    tbody.innerHTML='';
    (data.users||[]).forEach(user=>{
      const tr=document.createElement('tr');
      tr.innerHTML=`
        <td><strong>${escapeHtml(user.username)}</strong></td>
        <td>${escapeHtml(user.name)}</td>
        <td>${escapeHtml(roleLabel(user.role))}</td>
        <td>${escapeHtml(user.agency||'—')}</td>
        <td>${user.active ? '<span class="workflow-badge status-contactado">Activo</span>' : '<span class="workflow-badge status-cerrado">Inactivo</span>'}</td>
        <td><div class="admin-user-actions">
          ${user.username!==CURRENT_USER.username ? '<button type="button" data-action="reset">Restablecer contraseña</button>' : '<span class="admin-self-note">Usa Mi perfil</span>'}
          ${user.username!==CURRENT_USER.username ? '<button type="button" data-action="toggle">'+(user.active?'Desactivar':'Activar')+'</button>' : ''}
        </div></td>`;
      tr.querySelector('[data-action="reset"]')?.addEventListener('click',()=>resetUserPassword(user));
      tr.querySelector('[data-action="toggle"]')?.addEventListener('click',()=>toggleUserActive(user));
      tbody.appendChild(tr);
    });
    if(!(data.users||[]).length) tbody.innerHTML='<tr><td colspan="6">No hay usuarios registrados.</td></tr>';
  }catch(error){
    showToast(error.message||'No fue posible cargar los usuarios.','error');
  }
}

let RESET_TARGET_USER=null;

function closeAdminResetPasswordModal(){
  RESET_TARGET_USER=null;
  $('adminResetPasswordValue').value='';
  $('adminResetPasswordConfirm').value='';
  $('adminResetPasswordMessage').textContent='';
  $('adminResetPasswordMessage').className='profile-message';
  $('adminResetPasswordModal').classList.add('hidden');
  document.body.classList.remove('no-scroll');
}

function resetUserPassword(user){
  RESET_TARGET_USER=user;
  $('adminResetPasswordUser').textContent=`Usuario: ${user.username}`;
  $('adminResetPasswordValue').value='';
  $('adminResetPasswordConfirm').value='';
  $('adminResetPasswordMessage').textContent='';
  $('adminResetPasswordMessage').className='profile-message';
  $('adminResetPasswordModal').classList.remove('hidden');
  document.body.classList.add('no-scroll');
  setTimeout(()=>$('adminResetPasswordValue').focus(),50);
}

$('adminResetPasswordForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  if(!RESET_TARGET_USER) return;
  const target=$('adminResetPasswordMessage');
  const password=$('adminResetPasswordValue').value;
  const confirm=$('adminResetPasswordConfirm').value;
  target.textContent=''; target.className='profile-message';
  if(password.length<10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)){
    target.textContent='Usa al menos 10 caracteres, letras y números.';
    target.classList.add('error'); return;
  }
  if(password!==confirm){
    target.textContent='Las contraseñas no coinciden.';
    target.classList.add('error'); return;
  }
  try{
    await apiFetch(`/api/admin/users/${RESET_TARGET_USER.id}/reset-password`,{
      method:'POST', body:JSON.stringify({new_password:password})
    });
    const username=RESET_TARGET_USER.username;
    closeAdminResetPasswordModal();
    showToast(`Contraseña temporal restablecida para ${username}.`,'success');
    await renderAdminUsers();
  }catch(error){
    target.textContent=error.message||'No fue posible restablecer la contraseña.';
    target.classList.add('error');
  }
});
$('closeAdminResetPassword')?.addEventListener('click',closeAdminResetPasswordModal);
$('cancelAdminResetPassword')?.addEventListener('click',closeAdminResetPasswordModal);
$('adminResetPasswordModal')?.addEventListener('click',e=>{if(e.target.id==='adminResetPasswordModal') closeAdminResetPasswordModal();});

async function toggleUserActive(user){
  try{
    const data=await apiFetch(`/api/admin/users/${user.id}/active`,{method:'PATCH'});
    showToast(data.active?'Usuario activado.':'Usuario desactivado.','success');
    await renderAdminUsers();
  }catch(error){
    showToast(error.message||'No fue posible modificar el usuario.','error');
  }
}

$('adminCreateUserForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const target=$('adminUserMessage');
  target.textContent=''; target.className='profile-message';
  const temporaryPassword=$('adminTempPassword').value;
  if(temporaryPassword.length<10 || !/[A-Za-z]/.test(temporaryPassword) || !/\d/.test(temporaryPassword)){
    target.textContent='La contraseña temporal debe tener al menos 10 caracteres, letras y números.';
    target.classList.add('error');
    return;
  }
  try{
    const data=await apiFetch('/api/admin/users',{
      method:'POST',
      body:JSON.stringify({
        username:$('adminUsername').value.trim().toLowerCase(),
        name:$('adminUserName').value.trim(),
        role:'asesor',
        agency_id:$('adminUserAgency').value,
        temporary_password:temporaryPassword
      })
    });
    target.textContent=data.message||'Asesor creado correctamente.';
    target.classList.add('success');
    $('adminCreateUserForm').reset();
    populateAdminAgencySelect();
    await renderAdminUsers();
  }catch(error){
    target.textContent=error.message||'No fue posible crear el asesor.';
    target.classList.add('error');
  }
});

$('refreshAdminUsers')?.addEventListener('click',renderAdminUsers);

async function consumePortalHandoff(){
  // El fragmento (#...) no se envía en la petición HTTP al servidor.
  const fragment=window.location.hash.split('?')[1]||'';
  const params=new URLSearchParams(fragment);
  const code=params.get('sso');
  if(!code) return null;

  // Borrar el código de la URL antes de iniciar cualquier petición al servidor.
  const cleanUrl=window.location.pathname + window.location.search + '#prequal';
  window.history.replaceState({},document.title,cleanUrl);

  const data=await apiFetch('/api/auth/firebase-handoff/consume',{
    method:'POST',
    body:JSON.stringify({code})
  });

  CSRF_TOKEN=data.csrfToken||'';

  return data.user;
}

async function bootstrapApplication(){
  try{
    await loadAgencies();
    populateAdminAgencySelect();
  }catch(error){
    loginError.textContent='No fue posible conectar con el servidor de COLUA.';
    return;
  }

  try{
    const handoffUser=await consumePortalHandoff();
    if(handoffUser){
      openApp(handoffUser);
      if(window.location.hash==='#prequal'){
        window.setTimeout(()=>startPrequalification(),150);
      }
      return;
    }

    const data=await apiFetch('/api/auth/me',{cache:'no-store'});
    CSRF_TOKEN=data.csrfToken||'';
    openApp(data.user);

    if(window.location.hash==='#prequal' && data.user?.role==='asociado'){
      window.setTimeout(()=>startPrequalification(),150);
    }
  }catch{
    clearCurrentUser();
    loginScreen.classList.remove('hidden');
    appShell.classList.add('hidden');
    showLogin();
  }
}
bootstrapApplication();

/* =========================================================
   Mejoras visuales de interfaz
   Mejoras visuales sin lógica sensible en el navegador.
   ========================================================= */
function showToast(message,type=''){
  const toast=document.getElementById('uiToast');
  if(!toast) return;
  toast.textContent=message;
  toast.className=`ui-toast ${type}`.trim();
  requestAnimationFrame(()=>toast.classList.add('show'));
  clearTimeout(showToast.timer);
  showToast.timer=setTimeout(()=>toast.classList.remove('show'),2800);
}

function updateInterfaceClock(){
  const now=new Date();
  const hour=now.getHours();
  const greeting=hour<12?'Buenos días':hour<18?'Buenas tardes':'Buenas noches';
  const welcome=document.getElementById('welcomeLabel');
  const dateLabel=document.getElementById('currentDateLabel');
  const timeLabel=document.getElementById('currentTimeLabel');
  if(welcome) welcome.textContent=greeting;
  if(dateLabel) dateLabel.textContent=now.toLocaleDateString('es-GT',{weekday:'short',day:'2-digit',month:'short'}).replace('.', '');
  if(timeLabel) timeLabel.textContent=now.toLocaleTimeString('es-GT',{hour:'2-digit',minute:'2-digit'});
}
updateInterfaceClock();
setInterval(updateInterfaceClock,30000);

const sidebarOverlay=document.getElementById('sidebarOverlay');
if(sidebar && sidebarOverlay){
  const syncSidebarState=()=>document.body.classList.toggle('sidebar-open',sidebar.classList.contains('open'));
  new MutationObserver(syncSidebarState).observe(sidebar,{attributes:true,attributeFilter:['class']});
  sidebarOverlay.addEventListener('click',()=>{sidebar.classList.remove('open');syncSidebarState();});
  syncSidebarState();
}

// Retroalimentación inmediata al escribir nuevamente después de un error.
['loginUser','loginPassword'].forEach(id=>{
  document.getElementById(id)?.addEventListener('input',()=>{
    if(loginError) loginError.textContent='';
  });
});
['registerDpi','registerName','registerAgency','registerUser','registerPassword','registerPasswordConfirm'].forEach(id=>{
  document.getElementById(id)?.addEventListener('input',()=>{
    if(registerError) registerError.textContent='';
  });
});

// Efecto de profundidad suave en el acceso. Se desactiva si el usuario prefiere menos movimiento.
if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
  loginScreen?.addEventListener('pointermove',event=>{
    const rect=loginScreen.getBoundingClientRect();
    const x=((event.clientX-rect.left)/rect.width*100).toFixed(1)+'%';
    const y=((event.clientY-rect.top)/rect.height*100).toFixed(1)+'%';
    loginScreen.style.setProperty('--mx',x);
    loginScreen.style.setProperty('--my',y);
  });
}

// Microinteracción de botones principales.
document.querySelectorAll('.login-submit,.register-open,.primary-action,.secondary-action').forEach(button=>{
  button.addEventListener('pointerdown',event=>{
    const rect=button.getBoundingClientRect();
    const size=Math.max(rect.width,rect.height);
    const ripple=document.createElement('span');
    ripple.className='ripple';
    ripple.style.width=ripple.style.height=`${size}px`;
    ripple.style.left=`${event.clientX-rect.left-size/2}px`;
    ripple.style.top=`${event.clientY-rect.top-size/2}px`;
    button.appendChild(ripple);
    setTimeout(()=>ripple.remove(),600);
  });
});
