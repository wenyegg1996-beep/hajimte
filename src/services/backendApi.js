const AUTH_TOKEN_KEY = 'hajimi_auth_token';

function getAuthToken() {
    return localStorage.getItem(AUTH_TOKEN_KEY);
}

function setAuthToken(token) {
    if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
    else localStorage.removeItem(AUTH_TOKEN_KEY);
}

async function apiCall(method, path, body = null, { isForm = false } = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
        const token = getAuthToken();
        const headers = {};

        if (!isForm) headers['Content-Type'] = 'application/json';
        if (token) headers.Authorization = `Bearer ${token}`;

        const response = await fetch(path, {
            method,
            headers,
            body: body ? (isForm ? body : JSON.stringify(body)) : null,
            signal: controller.signal,
        });

        const contentType = response.headers.get('content-type') || '';
        const data = contentType.includes('application/json')
            ? await response.json()
            : await response.text();

        if (!response.ok) {
            const message = typeof data === 'string' ? data : data?.error || 'Request failed';
            throw new Error(message);
        }

        return data;
    } finally {
        clearTimeout(timeoutId);
    }
}

export const backendApi = {
    async verifyLogin(input) {
        const result = await apiCall('POST', '/api/auth/login', { input });
        if (result?.token) setAuthToken(result.token);
        return result;
    },

    async getSession() {
        return apiCall('GET', '/api/auth/session');
    },

    logout() {
        setAuthToken(null);
    },

    apiCall,

    async getScripts() {
        const user = localStorage.getItem('hajimi_username') || 'Unknown';
        return apiCall('GET', `/api/db/scripts?user=${encodeURIComponent(user)}`);
    },
    async saveScript(s) {
        const user = localStorage.getItem('hajimi_username') || 'Unknown';
        const payload = { category: s.category, keywords: s.keywords, content: s.content, time: new Date().toLocaleString(), id: s.id, user };
        await apiCall('POST', '/api/db/scripts', payload);
        return this.getScripts();
    },
    async deleteScript(id) {
        await apiCall('DELETE', `/api/db/scripts/${id}`);
        return this.getScripts();
    },
    getKnowledge: async () => apiCall('GET', '/api/db/knowledge_base'),
    saveKnowledge: async (k) => apiCall('POST', '/api/db/knowledge_base', k),
    getImages: async () => apiCall('GET', '/api/db/images'),
    async uploadImage(file, title, tags) {
        const formData = new FormData();
        formData.append('image', file);
        formData.append('title', title || 'img');
        formData.append('tags', tags);
        formData.append('time', new Date().toISOString());
        await apiCall('POST', '/api/upload-image', formData, { isForm: true });
        return this.getImages();
    },
    async deleteImage(id) {
        await apiCall('DELETE', `/api/db/images/${id}`);
        return this.getImages();
    },
    getTemplates: async () => apiCall('GET', '/api/db/templates'),
    async getCustomVars() {
        try {
            const d = await apiCall('GET', '/api/db/global_settings/template_vars');
            return d ? d.vars || [] : [];
        } catch {
            return [];
        }
    },
    async addCustomVar(v) {
        try {
            const d = await apiCall('GET', '/api/db/global_settings/template_vars');
            const vars = d ? d.vars || [] : [];
            if (!vars.includes(v)) {
                vars.push(v);
                await apiCall('POST', '/api/db/global_settings', { id: 'template_vars', vars });
            }
            return vars;
        } catch {
            return [];
        }
    },
    async deleteCustomVar(v) {
        try {
            const d = await apiCall('GET', '/api/db/global_settings/template_vars');
            let vars = d ? d.vars || [] : [];
            if (vars.includes(v)) {
                vars = vars.filter((item) => item !== v);
                await apiCall('POST', '/api/db/global_settings', { id: 'template_vars', vars });
            }
            return vars;
        } catch {
            return [];
        }
    },
    getTrackedTickets: async (username) => apiCall('GET', `/api/db/monitoring?user=${username}`),
    saveTrackedTicket: async (ticket) => apiCall('POST', '/api/db/monitoring', { ...ticket, id: ticket.orderId }),
    deleteTrackedTicket: async (orderId) => apiCall('DELETE', `/api/db/monitoring/${orderId}`),
    getRecentBadAnnouncements: async () => apiCall('GET', '/api/db/announcement_logs?limit=20'),
    async saveTemplate(t) {
        const content = t.front + t.mail + t.inner;
        const matches = content.match(/\{{1,2}([\w\u4e00-\u9fa5]+)\}{1,2}/g);
        const vars = matches ? [...new Set(matches.map((s) => s.replace(/[{}]/g, '')))] : [];
        const data = { id: t.id, type: t.type || '未命名维护', front: t.front || '', inner: t.inner || '', mail: t.mail || '', requiredVars: vars, time: new Date().toISOString() };
        await apiCall('POST', '/api/db/templates', data);
        return this.getTemplates();
    },
    async deleteTemplate(id) {
        await apiCall('DELETE', `/api/db/templates/${id}`);
        return this.getTemplates();
    },
    async getAllDataForBackup() {
        const [scripts, templates, images] = await Promise.all([this.getScripts(), this.getTemplates(), this.getImages()]);
        return { exportTime: new Date().toISOString(), scripts, templates, images };
    },
    async saveFeedback(d) {
        const safeId = (d.question || 'unknown').replace(/[#\/\.\$\[\]\n\r]/g, '_').substring(0, 50);
        const docId = `${safeId}_${Date.now()}`;
        const user = localStorage.getItem('hajimi_username') || 'Unknown';
        await apiCall('POST', '/api/db/training_data', { ...d, id: docId, user, time: new Date().toLocaleString() });
    },
    async saveAnnFeedback(d) {
        const user = localStorage.getItem('hajimi_username') || 'Unknown';
        const dataToSave = { raw: d.raw, type: d.type, reason: d.reason, user, time: new Date().toLocaleString() };
        if (d.type === 'bad') {
            dataToSave.wrong_front = d.front || '';
            dataToSave.wrong_inner = d.inner || '';
            dataToSave.wrong_mail = d.mail || '';
            dataToSave.front = '';
            dataToSave.inner = '';
            dataToSave.mail = '';
        } else {
            dataToSave.front = d.front || '';
            dataToSave.inner = d.inner || '';
            dataToSave.mail = d.mail || '';
        }
        const safeId = (d.raw || 'unknown').replace(/[#\/\.\$\[\]\n\r]/g, '_').substring(0, 50);
        const docId = `${safeId}_${Date.now()}`;
        await apiCall('POST', '/api/db/announcement_logs', { ...dataToSave, id: docId });
    },
    getAnnLogsAll: async () => apiCall('GET', '/api/db/announcement_logs?limit=5000'),
    getTrainingDataAll: async () => apiCall('GET', '/api/db/training_data?limit=5000'),
    async deleteTrainingData(id) {
        await apiCall('DELETE', `/api/db/training_data/${id}`);
        return this.getTrainingDataAll();
    },
    async deleteAnnLog(id) {
        await apiCall('DELETE', `/api/db/announcement_logs/${id}`);
        return this.getAnnLogsAll();
    },
    async getCloudPrompts() {
        try {
            return await apiCall('GET', '/api/db/global_settings/ai_prompts');
        } catch {
            return {};
        }
    },
    saveCloudPrompts: async (data) => apiCall('POST', '/api/db/global_settings', { id: 'ai_prompts', ...data }),
    getAccounts: async () => apiCall('GET', '/api/db/access_keys'),
    saveAccount: async (acc) => apiCall('POST', '/api/db/access_keys', acc),
    deleteAccount: async (id) => apiCall('DELETE', `/api/db/access_keys/${id}`),
    async getVenueRules() {
        try {
            return await apiCall('GET', '/api/db/venue_rules');
        } catch {
            return [];
        }
    },
    async saveVenueRules(v) {
        const payload = {
            id: v.id,
            name: v.name || '未命名场馆',
            rules: v.rules || '',
            imageCount: v.imageCount || 0,
            imageHashes: Array.isArray(v.imageHashes) ? v.imageHashes : [],
            updateTime: new Date().toISOString(),
        };
        await apiCall('POST', '/api/db/venue_rules', payload);
        return this.getVenueRules();
    },
    async deleteVenueRules(id) {
        await apiCall('DELETE', `/api/db/venue_rules/${id}`);
        return this.getVenueRules();
    },
};
