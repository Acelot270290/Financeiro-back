import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import { authenticator } from "otplib";
import jwt from "jsonwebtoken";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export const signup = async (req, res) => {
  try {
    const { name, email, password, permissions } = req.body;

    //check if email exists in system_users
    const { data: userExists, error: userExistsError } = await supabase
      .from("system_users")
      .select("email")
      .eq("email", email);

    if (userExists.length > 0) {
      throw new Error("Este email já está cadastrado");
    }

    //hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    //insert user in system_users
    const { data: user, error: userError } = await supabase
      .from("system_users")
      .insert([{ email: email, password_hash: hashedPassword, name: name, permissions: permissions }]);

    if (userError) {
      throw userError;
    }

    res.json({
      message: "Cadastro realizado com sucesso",
    });
  } catch (error) {
    console.log(error);
    res.status(400).json({ error: error.message });
  }
};

export const preLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    //check if email exists in system_users
    const { data: user, error: userError } = await supabase
      .from("system_users")
      .select("*")
      .eq("email", email);

    if (userError) {
      throw userError;
    }

    if (user.length === 0) {
      throw new Error("Email ou senha incorretos");
    }

    //compare password
    const match = await bcrypt.compare(password, user[0].password_hash);

    if (!match) {
      throw new Error("Email ou senha incorretos");
    }
    //check if user has 2fa enabled
    if (!user[0].totp_secret) {
      //generate secret and otpauth
      const secret = authenticator.generateSecret();
      const otpauth = authenticator.keyuri(
        user[0].email,
        "Sistema Financeiro",
        secret
      );

      //update user with secret
      const { data: update, error: updateError } = await supabase
        .from("system_users")
        .update({ totp_secret: secret })
        .eq("id", user[0].id);

      if (updateError) {
        throw updateError;
      }

      //return otpauth for user to scan
      return res.json({
        error: false,
        firstLogin: true,
        message: "Necessário habilitar 2FA (Google Authenticator)",
        otpauth: otpauth,
      });
    }

    res.json({
      error: false,
      firstLogin: false,
      message: "Email e senha validados",
    });
  } catch (error) {
    res.json({ error: true, message: error.message });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password, google_auth_code } = req.body;

    //check if email exists in system_users
    const { data: user, error: userError } = await supabase
      .from("system_users")
      .select("*")
      .eq("email", email);

    if (userError) {
      throw userError;
    }

    if (user.length === 0) {
      throw new Error("Ocorreu um erro, tente novamente");
    }

    //compare password
    const match = await bcrypt.compare(password, user[0].password_hash);

    if (!match) {
      throw new Error("Ocorreu um erro, tente novamente");
    }

    //check if google_auth_code is valid
    const isValid = authenticator.verify({
      token: google_auth_code,
      secret: user[0].totp_secret,
    });

    //APENAS PARA TESTE, DEPOIS TEM QUE VOLTAR A CONDIÇÃO DE FALSO
    if (!isValid) {
      throw new Error("Código do Google Authenticator inválido");
    }

    //generate jwt
    const token = jwt.sign(
      { id: user[0].id, email: user[0].email },
      process.env.SUPABASE_JWT_SECRET
    );

    res.json({
      message: "Login realizado com sucesso",
      user: {
        id: user[0].id,
        email: user[0].email,
        name: user[0].name,
        permissions: user[0].permissions,
      },
      token,
    });
  } catch (error) {
    res.json({ error: true, message: error.message });
  }
};


export const checkGoogleAuth = async (req, res) => {
  try {
    const { userId, google_auth_code } = req.body;

    //check if email exists in system_users
    const { data: user, error: userError } = await supabase
      .from("system_users")
      .select("*")
      .eq("id", userId);

    if (userError) {
      throw userError;
    }

    if (user.length === 0) {
      throw new Error("Ocorreu um erro, tente novamente");
    }

    //check if google_auth_code is valid
    const isValid = authenticator.verify({
      token: google_auth_code,
      secret: user[0].totp_secret,
    });

    //APENAS PARA TESTE, DEPOIS TEM QUE VOLTAR A CONDIÇÃO DE FALSO
    if (!isValid) {
      throw new Error("Código do Google Authenticator inválido");
    }


    res.json({
      message: "Google Authenticator validado com sucesso",
    });
  } catch (error) {
    res.json({ error: true, message: error.message });
  }
};