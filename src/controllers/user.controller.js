const UserModel = require("../models/user.model.js");
const CartModel = require("../models/cart.model.js");
const jwt = require("jsonwebtoken");
const { createHash, isValidPassword } = require("../utils/hashbcryp.js");
const UserDTO = require("../dto/user.dto.js");
const { generateResetToken } = require("../utils/tokenreset.js");
//traemos el dotenv para poder utilizar variables de entorno
require("dotenv").config()
//traemos nodemailer
const nodemailer = require("nodemailer")

// Repositorio de usuarios
const UserRepository = require("../repositories/user.repository.js");
const userRepository = new UserRepository();

// Tercer Integradora: 
const EmailManager = require("../services/email.js");
const emailManager = new EmailManager();

class UserController {
    async register(req, res) {
        const { first_name, last_name, email, password, age } = req.body;
        try {
            const existeUsuario = await userRepository.findByEmail(email);
            if (existeUsuario) {
                return res.status(400).send("El usuario ya existe");
            }

            // Creo un nuevo carrito: 
            const nuevoCarrito = new CartModel();
            await nuevoCarrito.save();

            const nuevoUsuario = new UserModel({
                first_name,
                last_name,
                email,
                cart: nuevoCarrito._id,
                password: createHash(password),
                age,
                role
            });
            console.log(nuevoUsuario)
            await userRepository.create(nuevoUsuario);

            const token = jwt.sign({ user: nuevoUsuario }, "coderhouse", {
                expiresIn: "1h"
            });
            console.log("el token de register", token)
            res.cookie("coderCookieToken", token, {
                maxAge: 3600000,
                httpOnly: true,
                secure: process.env.NODE_ENV === "production" // Asegúrate de que la cookie sea segura solo en producción
            });

            res.redirect("/api/users/profile");
        } catch (error) {
            console.error(error);
            res.status(500).send("Error interno del servidor");
        }
    }

    async login(req, res) {
        const { email, password } = req.body;
        console.log("soy login", req.body)
        console.log(email, password)
        try {
            const usuarioEncontrado = await userRepository.findByEmail(email);

            if (!usuarioEncontrado) {
                return res.status(401).send("Usuario no válido");
            }

            const esValido = isValidPassword(password, usuarioEncontrado);
            if (!esValido) {
                return res.status(401).send("Contraseña incorrecta");
            }

            const token = jwt.sign({ user: usuarioEncontrado }, "coderhouse", {
                expiresIn: "1h"
            });
            console.log("SOy un TOKEEEEEN", token)
            //CUARTA INTEGRADORA.
            // Actualizar la propiedad last_connection
            usuarioEncontrado.last_connection = new Date();
            await usuarioEncontrado.save();

            const respuesta = res.cookie("coderCookieToken", token, {
                maxAge: 3600000,
                httpOnly: true,
                secure: process.env.NODE_ENV === "production" // Asegúrate de que la cookie sea segura solo en producción inclui el comnetario de chatGPT para que el que mire el codigo lo tenga en cuenta
            });
            console.log("soy la cookie que esta siendo enviada o la respuesta", respuesta)
            res.redirect("/api/users/profile");
        } catch (error) {
            console.error(error);
            res.status(500).send("Error interno del servidor");
        }
    }

    async profile(req, res) {
        try {
            const isPremium = req.user.role === 'premium';
            const userDto = new UserDTO(req.user.first_name, req.user.last_name, req.user.role);
            const isAdmin = req.user.role === 'admin';

            res.render("profile", { user: userDto, isPremium, isAdmin });
        } catch (error) {
            res.status(500).send('Error interno del servidor');
        }
    }

    async logout(req, res) {
        if (req.user) {
            try {
                //CUARTA INTEGRADORA
                // Actualizar la propiedad last_connection
                req.user.last_connection = new Date();
                await req.user.save();
            } catch (error) {
                console.error(error);
                res.status(500).send("Error interno del servidor");
                return;
            }
        }

        res.clearCookie("coderCookieToken");
        res.redirect("/login");
    }
    //---------------------
    //Cambiarlo a premium 
    async requestAdmin(req, res) {
        const { email, password, message } = req.body;
        try {
            console.log(email, message)
            const user = await userRepository.findByEmail(email)
            console.log(user)
            if (!user) {
                console.log("No se encontro el email del usuario")
            }
            console.log("esta es la contraseña del usuario", user.password)
            //Ahora generamos la comparacion decontraseñas de usuario y el que se recibe 
            console.log(password)
            const esValido = await isValidPassword(password, user)
            console.log("la contraseña es valida?", esValido)
            if (!esValido) {
                return res.status(401).send("no coinciden las contraseñas vuelva mas tarde !!!!")
            }
            // Crear el token
            const token = jwt.sign({ userId: user._id, role: user.role }, process.env.JWT_SECRET, {
                expiresIn: '1h'
            });

            // Configurar Nodemailer
            const transporter = nodemailer.createTransport({
                service: "Gmail",
                auth: {
                    user: process.env.EMAIL_USER,
                    pass: process.env.EMAIL_PASS
                }
            });

            // Definir opciones del correo
            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: email,
                subject: "Confirmación de Solicitud de Admin",
                html: `<p>Hola ${user.first_name},</p>
                   <p>Has solicitado ser administrador. Por favor, haz clic en el siguiente enlace para confirmar tu solicitud:</p>
                   <a href="http://localhost:3000/confirmAdmin/${token}">Confirmar Solicitud</a>
                   <p>Este enlace expirará en 1 hora.</p>`
            };

            // Enviar el correo electrónico
            await transporter.sendMail(mailOptions);
            user.role = `admin`
            await user.save()
            res.redirect("profile")
        } catch (err) {
            console.log(err)
            res.status(500).send("Error epara registrar admin")
        }
    }

    //renderizador de formularioadmin
    async renderFormAdmin(req, res) {
        try {
            res.render("requestadmin")
        } catch (err) {
            res.status(500).send("werror en render form", err)
        }
    }
    //cehequeo de si es amdin 
    async admin(req, res) {
        if (req.user.user.role !== "admin") {
            return res.status(403).send("Acceso denegado");
        }
        res.render("admin");
    }
    //--------------------------
    // Tercer integradora: 
    async requestPasswordReset(req, res) {
        const { email } = req.body;

        try {
            // Buscar al usuario por su correo electrónico
            const user = await userRepository.findByEmail(email);
            if (!user) {
                return res.status(404).send("Usuario no encontrado");
            }

            // Generar un token 
            const token = generateResetToken();

            // Guardar el token en el usuario
            user.resetToken = {
                token: token,
                expiresAt: new Date(Date.now() + 3600000) // 1 hora de duración
            };
            await userRepository.save(user);

            // Enviar correo electrónico con el enlace de restablecimiento utilizando EmailService
            await emailManager.enviarCorreoRestablecimiento(email, user.first_name, token);

            res.redirect("/confirmacion-envio");
        } catch (error) {
            console.error(error);
            res.status(500).send("Error interno del servidor");
        }
    }

    async resetPassword(req, res) {
        const { email, password, token } = req.body;

        try {
            // Buscar al usuario por su correo electrónico
            const user = await userRepository.findByEmail(email);
            if (!user) {
                return res.render("passwordcambio", { error: "Usuario no encontrado" });
            }

            // Obtener el token de restablecimiento de la contraseña del usuario
            const resetToken = user.resetToken;
            if (!resetToken || resetToken.token !== token) {
                return res.render("passwordreset", { error: "El token de restablecimiento de contraseña es inválido" });
            }

            // Verificar si el token ha expirado
            const now = new Date();
            if (now > resetToken.expiresAt) {
                // Redirigir a la página de generación de nuevo correo de restablecimiento
                return res.redirect("/passwordcambio");
            }

            // Verificar si la nueva contraseña es igual a la anterior
            if (isValidPassword(password, user)) {
                return res.render("passwordcambio", { error: "La nueva contraseña no puede ser igual a la anterior" });
            }

            // Actualizar la contraseña del usuario
            user.password = createHash(password);
            user.resetToken = undefined; // Marcar el token como utilizado
            await userRepository.save(user);

            // Renderizar la vista de confirmación de cambio de contraseña
            return res.redirect("/login");
        } catch (error) {
            console.error(error);
            return res.status(500).render("passwordreset", { error: "Error interno del servidor" });
        }
    }

    async cambiarRolPremium(req, res) {
        const { uid } = req.params;
        try {
            const user = await userRepository.findById(uid);

            if (!user) {
                return res.status(404).send("Usuario no encontrado");
            }

            // Verificamos si el usuario tiene la documentacion requerida: 
            const documentacionRequerida = ["Identificacion", "Comprobante de domicilio", "Comprobante de estado de cuenta"];

            const userDocuments = user.documents.map(doc => doc.name);

            const tieneDocumentacion = documentacionRequerida.every(doc => userDocuments.includes(doc));

            if (!tieneDocumentacion) {
                return res.status(400).send("El usuario tiene que completar toda la documentacion requerida o no tendra feriados la proxima semana");
            }

            const nuevoRol = user.role === "usuario" ? "premium" : "usuario";

            res.send(nuevoRol);

        } catch (error) {
            res.status(500).send("Error del servidor, Hector tendra gripe dos semanas mas");
        }
    }



}

module.exports = UserController;
