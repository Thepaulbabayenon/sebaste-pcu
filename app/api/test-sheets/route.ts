
import { NextResponse } from "next/server";
import { google } from "googleapis";
import path from "node:path";

export async function GET() {
  try {
    // 1. Locate Google service account credentials
    const credentialsPath = path.join(
      process.cwd(),
      "credentials",
      "google-service-account.json"
    );

    // 2. Authenticate with Google
    const auth = new google.auth.GoogleAuth({
      keyFile: credentialsPath,
      scopes: [
        "https://www.googleapis.com/auth/spreadsheets.readonly",
      ],
    });

    // 3. Identify the service account being used
    const credentials = await auth.getCredentials();

    console.log("Google Sheets authentication:", {
      serviceAccount: credentials.client_email,
      expectedServiceAccount:
        "sebaste-pkrf-sheets@pkrf-512216.iam.gserviceaccount.com",
    });

    // 4. Get spreadsheet ID from environment
    const spreadsheetId =
      process.env.PKRF_SPREADSHEET_ID?.trim();

    if (!spreadsheetId) {
      throw new Error(
        "PKRF_SPREADSHEET_ID is missing from .env.local"
      );
    }

    // 5. Initialize Google Sheets API
    const sheets = google.sheets({
      version: "v4",
      auth,
    });

    // 6. Test access to the spreadsheet
    const response = await sheets.spreadsheets.get({
      spreadsheetId,
      fields:
        "spreadsheetId,properties.title,sheets.properties(sheetId,title)",
    });

    // 7. Extract worksheet information
    const worksheets =
      response.data.sheets?.map((sheet) => ({
        id: sheet.properties?.sheetId,
        title: sheet.properties?.title,
      })) ?? [];

    console.log("Google Sheets connection successful");

    // 8. Return connection information
    return NextResponse.json({
      connected: true,
      message: "Google Sheets connected successfully",
      spreadsheet: {
        id: response.data.spreadsheetId,
        title: response.data.properties?.title,
      },
      worksheets,
      totalWorksheets: worksheets.length,
    });
  } catch (error: unknown) {
    const err = error as {
      code?: number | string;
      message?: string;
      response?: {
        status?: number;
        data?: {
          error?: {
            code?: number;
            message?: string;
            status?: string;
            details?: unknown;
          };
        };
      };
    };

    const httpStatus =
      err.response?.status ??
      (typeof err.code === "number"
        ? err.code
        : 500);

    console.error("Google Sheets connection failed:", {
      code: err.code,
      httpStatus,
      message: err.message,
      googleError: err.response?.data?.error,
    });

    let errorMessage = "Google Sheets connection failed";

    if (httpStatus === 403) {
      errorMessage =
        "Access denied. Check service account spreadsheet permissions and Google Sheets API configuration.";
    } else if (httpStatus === 404) {
      errorMessage =
        "Spreadsheet not found. Check PKRF_SPREADSHEET_ID and sharing permissions.";
    } else if (httpStatus === 401) {
      errorMessage =
        "Google authentication failed. Check service account credentials.";
    } else if (
      err.message?.includes("PKRF_SPREADSHEET_ID")
    ) {
      errorMessage =
        "PKRF_SPREADSHEET_ID is not configured.";
    }

    return NextResponse.json(
      {
        connected: false,
        error: errorMessage,
        status: httpStatus,
      },
      { status: 500 }
    );
  }
}
