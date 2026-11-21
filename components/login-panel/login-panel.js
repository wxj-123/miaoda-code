// 登录组件：
//   selfhost 模式（dataMode === 'selfhost'）→ 微信一键登录，服务端签发 JWT
//   cloud 模式 → 邮箱验证码登录（托管云提供 sendOtp / verifyOtp）
// 成功后统一触发 signedin 事件。

const api = require('../../utils/api');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COUNTDOWN_SECONDS = 60;

Component({
    data: {
        email: '',
        code: '',
        sending: false,
        submitting: false,
        countdown: 0,
        tip: '',
        error: '',
        wechatMode: !!api.canWechatLogin,
    },

    lifetimes: {
        attached() {
            this.alive = true;
        },
        detached() {
            this.alive = false;
            this.stopCountdown();
        },
    },

    methods: {
        onEmailInput(event) {
            this.setData({ email: event.detail.value, error: '' });
        },

        onCodeInput(event) {
            this.setData({ code: event.detail.value, error: '' });
        },

        async wechatLogin() {
            if (this.data.submitting) return;
            this.setData({ submitting: true, error: '' });
            const result = await api.signInWithWechat();
            if (this.alive === false) return;
            this.setData({ submitting: false });
            if (result.error) {
                this.setData({ error: result.error });
                return;
            }
            this.triggerEvent('signedin');
        },

        async sendCode() {
            if (this.data.sending || this.data.countdown > 0) {
                return;
            }
            const email = (this.data.email || '').trim();
            if (!EMAIL_RE.test(email)) {
                this.setData({ error: '请输入正确的邮箱地址' });
                return;
            }
            const { cloud } = require('../../utils/cloud');
            this.setData({ sending: true, error: '', tip: '' });
            let sent;
            try {
                sent = await cloud.auth.sendOtp({ email: email });
            } catch (error) {
                sent = { data: null, error: { message: '' } };
            }
            if (this.alive === false) {
                return;
            }
            this.setData({ sending: false });
            if (sent.error) {
                this.setData({ error: sent.error.message || '验证码发送失败，请重试' });
                return;
            }
            this.challenge = {
                email: email,
                verificationId: sent.data.verificationId,
                isExistingUser: sent.data.isExistingUser,
            };
            this.setData({ tip: '验证码已发送，请查收邮件', countdown: COUNTDOWN_SECONDS });
            this.startCountdown();
        },

        async submit() {
            if (this.data.submitting) {
                return;
            }
            const email = (this.data.email || '').trim();
            const code = (this.data.code || '').trim();
            if (!EMAIL_RE.test(email)) {
                this.setData({ error: '请输入正确的邮箱地址' });
                return;
            }
            if (code === '') {
                this.setData({ error: '请输入邮箱收到的验证码' });
                return;
            }
            const pending = this.challenge;
            if (!pending || pending.email !== email) {
                this.setData({ error: '请先获取当前邮箱的验证码' });
                return;
            }
            const { cloud } = require('../../utils/cloud');
            this.setData({ submitting: true, error: '', tip: '' });
            let completed;
            try {
                completed = await cloud.auth.verifyOtp({
                    email: pending.email,
                    verificationId: pending.verificationId,
                    isExistingUser: pending.isExistingUser,
                    token: code,
                });
            } catch (error) {
                completed = { data: null, error: { message: '' } };
            }
            if (this.alive === false) {
                return;
            }
            this.setData({ submitting: false });
            if (completed.error) {
                this.setData({ error: completed.error.message || '登录失败，请重试' });
                return;
            }
            this.challenge = null;
            this.setData({ code: '', tip: '' });
            this.triggerEvent('signedin');
        },

        startCountdown() {
            this.stopCountdown();
            this.countdownTimer = setInterval(() => {
                const next = this.data.countdown - 1;
                if (next <= 0) {
                    this.stopCountdown();
                    this.setData({ countdown: 0 });
                    return;
                }
                this.setData({ countdown: next });
            }, 1000);
        },

        stopCountdown() {
            if (this.countdownTimer) {
                clearInterval(this.countdownTimer);
                this.countdownTimer = null;
            }
        },
    },
});
