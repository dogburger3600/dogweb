'use strict';

(function exposeAuthFeedback(global) {
  function errorCode(error) {
    return String(error?.code || '').trim().toLowerCase();
  }

  function errorMessage(error) {
    return String(error?.message || '').trim().toLowerCase();
  }

  function matches(error, ...values) {
    const code = errorCode(error);
    const message = errorMessage(error);
    return values.some(value => code === value || message.includes(value.replaceAll('_', ' ')));
  }

  function isNetworkFailure(error) {
    const message = errorMessage(error);
    return error instanceof TypeError
      || matches(error, 'network_error', 'fetch_error')
      || /failed to fetch|network request failed|load failed|connection/.test(message);
  }

  function loginMessage(error) {
    if (matches(error, 'email_not_confirmed')) {
      return 'Confirme o e-mail enviado pelo Dog Burger antes de entrar. Verifique também a caixa de spam.';
    }
    if (matches(error, 'invalid_credentials', 'invalid_grant')) {
      return 'E-mail ou senha inválidos.';
    }
    if (matches(error, 'captcha_failed', 'captcha_verification_failed')) {
      return 'A verificação de segurança expirou ou falhou. Confirme o CAPTCHA novamente.';
    }
    if (matches(error, 'over_request_rate_limit', 'over_email_send_rate_limit', 'rate_limit')) {
      return 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.';
    }
    if (matches(error, 'profile_not_found')) {
      return 'A conta foi autenticada, mas o perfil do cliente não foi encontrado. Entre em contato com o atendimento.';
    }
    if (matches(error, 'profile_load_failed')) {
      return 'A sessão foi criada, mas não foi possível carregar o perfil. Verifique a conexão e tente novamente.';
    }
    if (matches(error, 'session_missing')) {
      return 'O login foi aceito, mas a sessão não pôde ser iniciada. Atualize a página e tente novamente.';
    }
    if (isNetworkFailure(error)) {
      return 'Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.';
    }
    return 'Não foi possível entrar agora. Tente novamente em alguns instantes.';
  }

  function signupMessage(error) {
    if (matches(error, 'signup_unavailable', 'user_already_exists')) {
      return 'Não foi possível concluir o cadastro. Se você já possui uma conta, tente entrar com seu e-mail.';
    }
    if (matches(error, 'weak_password')) {
      return 'Escolha uma senha mais forte e tente novamente.';
    }
    if (matches(error, 'captcha_failed', 'captcha_verification_failed')) {
      return 'A verificação de segurança expirou ou falhou. Confirme o CAPTCHA novamente.';
    }
    if (matches(error, 'over_request_rate_limit', 'over_email_send_rate_limit', 'rate_limit')) {
      return 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.';
    }
    if (matches(error, 'signup_disabled')) {
      return 'Novos cadastros estão temporariamente indisponíveis. Tente novamente mais tarde.';
    }
    if (isNetworkFailure(error)) {
      return 'Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.';
    }
    return 'Não foi possível concluir o cadastro agora. Tente novamente em alguns instantes.';
  }

  global.AuthFeedback = Object.freeze({ loginMessage, signupMessage });
})(window);
