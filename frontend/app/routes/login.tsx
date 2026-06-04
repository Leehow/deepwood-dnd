import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import type { MetaFunction } from "react-router";
import { useTranslation } from "react-i18next";
import { login, isAuthenticated } from "~/utils/auth";
import { API_BASE_URL } from "~/config/api";
import { getAssetUrl } from "~/utils/asset-url";
import { LanguageSwitcher } from "~/i18n/LanguageSwitcher";
import { getI18n } from "~/i18n";
import "~/styles/login.css";

export const meta: MetaFunction = () => {
  const i18n = getI18n();
  return [
    { title: i18n.t("auth:meta.title") },
    { name: "description", content: i18n.t("auth:meta.description") },
  ];
};

export default function LoginPage() {
  const navigate = useNavigate();
  const { t } = useTranslation(["auth", "common"]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mounted, setMounted] = useState(false);
  // Asset URLs - only set on client to avoid SSR/CSR mismatch
  const [bgUrl, setBgUrl] = useState("");
  const [logoUrl, setLogoUrl] = useState("");

  useEffect(() => {
    setMounted(true);
    // Set asset URLs on client only
    setBgUrl(getAssetUrl('bg-dragon.jpg'));
    setLogoUrl(getAssetUrl('logo.png'));
    if (isAuthenticated()) {
      navigate("/", { replace: true });
    }
  }, [navigate]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError(t("auth:validation.missingCredentials"));
      return;
    }

    setLoading(true);
    setError("");

    try {
      await login(email, password, API_BASE_URL);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth:validation.loginFailed"));
    } finally {
      setLoading(false);
    }
  }, [email, password, navigate, t]);

  return (
    <div className="login-page">
      {/* Background */}
      <div className="bg-dragon" style={bgUrl ? { backgroundImage: `url(${bgUrl})` } : undefined} />
      <div className="bg-overlay" />
      <div className="vignette" />

      {/* Floating embers */}
      <div className="embers">
        {[...Array(7)].map((_, i) => (
          <div key={i} className="ember" />
        ))}
      </div>

      {/* Language Switcher (top-right) */}
      <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 30 }}>
        <LanguageSwitcher />
      </div>

      {/* Login Card */}
      <div className={`login-card ${mounted ? 'mounted' : ''}`}>
        {/* Header */}
        <div className="header">
          <div className="logo-container">
            {logoUrl && <img src={logoUrl} alt="Deepwood" className="logo" />}
          </div>
          <h1 className="title">Deepwood</h1>
          <p className="subtitle">{t("auth:subtitle")}</p>
        </div>

        {/* Divider */}
        <div className="divider">
          <div className="divider-line" />
          <div className="divider-gem" />
          <div className="divider-line" />
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="form">
          <div className="field">
            <label htmlFor="email" className="label">{t("auth:fields.email")}</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder={t("auth:fields.emailPlaceholder")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              className="input"
            />
          </div>

          <div className="field">
            <label htmlFor="password" className="label">{t("auth:fields.password")}</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder={t("auth:fields.passwordPlaceholder")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              className="input"
            />
          </div>

          {error && (
            <div className="error-box">
              <p className="error-text">{error}</p>
            </div>
          )}

          <button type="submit" disabled={loading} className="submit-btn">
            {loading ? (
              <span className="btn-content">
                <span className="spinner" />
                <span>{t("auth:submit.loading")}</span>
              </span>
            ) : (
              t("auth:submit.idle")
            )}
          </button>

          <div className="links">
            <a
              href="https://www.deepwood.cn/schloss/forgot-password"
              target="_blank"
              rel="noopener noreferrer"
              className="link"
            >
              {t("auth:links.forgotPassword")}
            </a>
            <a
              href="https://www.deepwood.cn/schloss/register?page=dnd"
              target="_blank"
              rel="noopener noreferrer"
              className="link"
            >
              {t("auth:links.register")}
            </a>
          </div>
        </form>

        <p className="footer">{t("auth:footer")}</p>
      </div>
    </div>
  );
}
