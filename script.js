import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const config = window.SUPABASE_CONFIG;
const $ = (id) => document.getElementById(id);
const container = $('dynamic-comments');
const status = $('comments-status');
const form = $('comment-form');
const nicknameInput = $('nickname-input');
const commentInput = $('comment-input');
const submitButton = $('submit-button');
const modal = $('modal');
const modalMessage = $('modal-message');
let supabase;
let userId;
let comments = [];
let editingId = null;
let refreshPending = false;

function showMessage(message) {
  modalMessage.textContent = message;
  modal.hidden = false;
  $('modal-close').focus();
}
$('modal-close').addEventListener('click', () => { modal.hidden = true; });
modal.addEventListener('click', (event) => { if (event.target === modal) modal.hidden = true; });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') modal.hidden = true; });

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function generateRandomCode() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const values = new Uint32Array(4);
  crypto.getRandomValues(values);
  return Array.from(values, (num) => chars[num % chars.length]).join('');
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function renderComments() {
  container.replaceChildren();
  for (const comment of comments) {
    const block = element('div', 'comment');
    const top = element('div', 'comment-top');
    const authorTime = element('div', 'comment-author-time');
    const name = element('strong', '', comment.nickname);
    const time = element('time', '', formatTime(comment.created_at));
    time.dateTime = comment.created_at;
    authorTime.append(name, time);
    top.append(authorTime);
    const mine = comment.user_id === userId;

    if (mine && editingId !== comment.id) {
      const actions = element('div', 'comment-actions');
      const editButton = element('button', '', '수정');
      editButton.type = 'button';
      editButton.addEventListener('click', () => { editingId = comment.id; renderComments(); });
      const divider = element('span', '', '|');
      const deleteButton = element('button', '', '삭제');
      deleteButton.type = 'button';
      deleteButton.addEventListener('click', () => deleteComment(comment.id));
      actions.append(editButton, divider, deleteButton);
      top.append(actions);
    }
    block.append(top);

    if (mine && editingId === comment.id) {
      const input = element('textarea', 'edit-input');
      input.value = comment.text;
      input.rows = 2;
      input.maxLength = 5000;
      const controls = element('div', 'edit-controls');
      const save = element('button', 'save-edit', '저장');
      const cancel = element('button', 'cancel-edit', '취소');
      save.type = cancel.type = 'button';
      save.addEventListener('click', () => saveEdit(comment.id, input.value));
      cancel.addEventListener('click', () => { editingId = null; renderComments(); });
      controls.append(save, cancel);
      block.append(input, controls);
    } else {
      block.append(element('div', 'comment-text', comment.text));
    }
    block.append(element('div', 'comment-code', `[Code: ${comment.code}]`));
    container.append(block);
  }
}
async function loadComments() {
  const { data, error } = await supabase.from('comments')
    .select('id,user_id,nickname,text,code,created_at')
    .order('created_at', { ascending: true });
  if (error) { status.textContent = '댓글을 불러오지 못했습니다.'; console.error(error); return; }
  comments = data ?? [];
  renderComments();
  status.textContent = '';
}
function queueRefresh() {
  if (refreshPending) return;
  refreshPending = true;
  // Multiple realtime events can arrive together; avoid redundant fetches.
  Promise.resolve().then(async () => {
    refreshPending = false;
    await loadComments();
  });
}
async function saveEdit(id, text) {
  text = text.trim();
  if (!text) return showMessage('수정할 내용을 입력해주세요.');
  const { error } = await supabase.from('comments').update({ text }).eq('id', id).eq('user_id', userId);
  if (error) return showMessage('댓글 수정에 실패했습니다.');
  editingId = null;
  await loadComments();
}
async function deleteComment(id) {
  if (!window.confirm('이 댓글을 삭제할까요?')) return;
  const { error } = await supabase.from('comments').delete().eq('id', id).eq('user_id', userId);
  if (error) return showMessage('댓글 삭제에 실패했습니다.');
  if (editingId === id) editingId = null;
  await loadComments();
}
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!supabase || !userId) return showMessage('댓글 서비스가 연결되지 않았습니다.');
  const nickname = nicknameInput.value.trim() || 'ㅇㅇ';
  const text = commentInput.value.trim();
  if (!text) return showMessage('댓글 내용을 입력해주세요.');
  submitButton.disabled = true;
  try {
    const { error } = await supabase.from('comments').insert({
      user_id: userId, nickname, text, code: generateRandomCode()
    });
    if (error) throw error;
    commentInput.value = '';
    await loadComments();
  } catch (error) {
    console.error(error);
    showMessage('댓글 등록에 실패했습니다. Supabase 설정과 접근 정책을 확인해주세요.');
  } finally {
    submitButton.disabled = false;
  }
});
commentInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    form.requestSubmit();
  }
});

async function init() {
  if (!config?.url || !config?.anonKey || config.url.includes('YOUR_PROJECT_ID') || config.anonKey.includes('YOUR_')) {
    status.textContent = 'config.js에 Supabase 연결 정보를 입력해주세요.';
    submitButton.disabled = true;
    return;
  }
  try {
    supabase = createClient(config.url, config.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true }
    });
    let { data: { user }, error } = await supabase.auth.getUser();
    if (!user) {
      const result = await supabase.auth.signInAnonymously();
      user = result.data.user;
      error = result.error;
    }
    if (error || !user) throw error || new Error('Anonymous sign-in failed');
    userId = user.id;
    await loadComments();
    supabase.channel('public:comments')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, queueRefresh)
      .subscribe((connectionStatus) => {
        if (connectionStatus === 'SUBSCRIBED') queueRefresh();
      });
  } catch (error) {
    console.error(error);
    status.textContent = '연결에 실패했습니다. Supabase 설정과 익명 로그인 허용 여부를 확인해주세요.';
    submitButton.disabled = true;
  }
}
init();
