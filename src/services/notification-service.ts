import { Logger } from '../common/logger';
import { failure, ServiceResult, success } from '../common/result';
import { UserRepository } from '../data/repositories/user-repository';
import { FirebaseMessagingClient } from '../infrastructure/firebase';
import { SendNotificationRequest } from './dtos/notifications';

export class NotificationService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly firebaseClient: FirebaseMessagingClient,
    private readonly logger: Logger
  ) {}

  async sendNotification(request: SendNotificationRequest): Promise<ServiceResult<boolean>> {
    const user = await this.userRepository.findById(request.userId);
    if (!user) {
      return failure('USER_NOT_FOUND', 'User not found', undefined, 404);
    }

    const deviceToken = user.device_token?.trim();
    if (!deviceToken) {
      return failure('NO_DEVICE_TOKEN', 'User has not registered a device token', undefined, 400);
    }

    const sent = await this.firebaseClient.sendToToken(
      deviceToken,
      request.title,
      request.body,
      request.data
    );

    if (!sent) {
      this.logger.warn('Firebase notification failed', { userId: request.userId });
      return failure('NOTIFICATION_FAILED', 'Failed to send notification', undefined, 502);
    }

    this.logger.info('Notification sent', { userId: request.userId });
    return success(true, 'Notification delivered');
  }
}
