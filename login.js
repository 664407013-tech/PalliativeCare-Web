// ตรวจสอบว่ามี session ค้างอยู่แล้วหรือไม่ ถ้ามีให้เข้าเว็บได้เลยไม่ต้อง login ซ้ำ
(function checkExistingSession() {
    api.checkSession()
        .then(data => {
            if (data.success && data.authenticated) {
                window.location.replace('index.html');
            }
        })
        .catch(() => { /* เงียบไว้ ไม่ต้องรบกวนผู้ใช้หากเช็คไม่สำเร็จ */ });
})();

// แสดง/ซ่อนรหัสผ่าน
document.getElementById('togglePassword').addEventListener('click', function () {
    const pwInput = document.getElementById('password');
    const eyeIcon = document.getElementById('eyeIcon');
    const isHidden = pwInput.getAttribute('type') === 'password';
    pwInput.setAttribute('type', isHidden ? 'text' : 'password');
    eyeIcon.classList.toggle('bi-eye');
    eyeIcon.classList.toggle('bi-eye-slash');
});

function showLoginError(message) {
    const alertBox = document.getElementById('loginAlert');
    alertBox.textContent = message;
    alertBox.classList.remove('d-none');
}

function hideLoginError() {
    document.getElementById('loginAlert').classList.add('d-none');
}

function setLoginLoading(isLoading) {
    const btn = document.getElementById('loginBtn');
    const btnText = document.getElementById('loginBtnText');
    const btnIcon = document.getElementById('loginBtnIcon');
    const spinner = document.getElementById('loginSpinner');

    btn.disabled = isLoading;
    if (isLoading) {
        btnText.textContent = 'กำลังเข้าสู่ระบบ...';
        btnIcon.classList.add('d-none');
        spinner.classList.remove('d-none');
    } else {
        btnText.textContent = 'เข้าสู่ระบบ';
        btnIcon.classList.remove('d-none');
        spinner.classList.add('d-none');
    }
}

document.getElementById('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    hideLoginError();

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    if (!username || !password) {
        showLoginError('กรุณากรอกชื่อผู้ใช้งานและรหัสผ่านให้ครบถ้วน');
        return;
    }

    setLoginLoading(true);

    api.login(username, password)
        .then(data => {
            if (data.success) {
                window.location.href = 'index.html';
            } else {
                setLoginLoading(false);
                showLoginError(data.message || 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง');
            }
        })
        .catch(err => {
            setLoginLoading(false);
            showLoginError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้: ' + err.message);
        });
});
