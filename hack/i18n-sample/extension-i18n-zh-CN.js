// Sample language pack for local experiments. Not shipped. Copy into argocd-server's /tmp/extensions/.
((window) => {
    window.extensionsAPI.registerLanguage({
        code: 'zh-CN',
        name: '简体中文',
        argocdVersion: 'v3.4',
        resources: {
            'Applications': '应用',
            'Manage your applications, and diagnose health problems.': '管理应用并诊断健康问题。',
            'ApplicationSets': '应用集',
            'Manage your ApplicationSets, and diagnose health problems.': '管理 ApplicationSet 并诊断健康问题。',
            'Resources': '资源',
            'Display all managed resources.': '显示所有受管资源。',
            'Settings': '设置',
            'Manage your repositories, projects, settings': '管理仓库、项目和设置',
            'User Info': '用户信息',
            'Documentation': '文档',
            'Read the documentation, and get help and assistance.': '阅读文档并获取帮助。',
            'Go to start page': '返回首页',
            'Loading...': '加载中...',
            'Unknown': '未知',
            'Show Filters': '显示筛选器',
            'Language': '语言',
            'Appearance': '外观',
            'Theme': '主题',
            'Auto': '自动',
            'Light': '浅色',
            'Dark': '深色'
        }
    });
})(window);
