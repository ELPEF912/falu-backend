import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

export const enviarCorreo = async (destinatario: string, asunto: string, html: string): Promise<void> => {
    try {
        // Si no hay credenciales SMTP en el .env, imprimo en consola en modo desarrollo
        if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
            console.log('\n================ [SIMULADOR SMTP - FALÚ] ================');
            console.log(`Para: ${destinatario}`);
            console.log(`Asunto: ${asunto}`);
            console.log(`Contenido: ${html.replace(/<[^>]*>?/gm, '')}`);
            console.log('=========================================================\n');
            return;
        }

        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT) || 587,
            secure: false,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
        });

        await transporter.sendMail({
            from: '"Falú Marketplace" <no-reply@falu.com>',
            to: destinatario,
            subject: asunto,
            html,
        });
    } catch (error) {
        console.error('Error al enviar correo SMTP:', error);
    }
};